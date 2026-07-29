/**
 * Unit tests — victoria especial Color / Póker en la tabla final.
 * Ejemplo real: ganar con Color no debe contar puntos ni “grupos” de melar.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    crearCarta,
    cartasDeColor,
    cartasDePoker,
    GolpeadoGame
} from '../../game.js';

describe('cartasDeColor', () => {
    it('detecta ≥7 del mismo palo', () => {
        const mano = [
            crearCarta('H', 1), crearCarta('H', 3), crearCarta('H', 5),
            crearCarta('H', 7), crearCarta('H', 9), crearCarta('H', 11),
            crearCarta('H', 13), crearCarta('S', 2)
        ];
        const color = cartasDeColor(mano);
        assert.equal(color.length, 7);
        assert.ok(color.every(c => c.suit === 'H'));
    });

    it('no detecta color con menos de 7', () => {
        const mano = [
            crearCarta('H', 1), crearCarta('H', 2), crearCarta('H', 3),
            crearCarta('H', 4), crearCarta('H', 5), crearCarta('H', 6),
            crearCarta('S', 7)
        ];
        assert.equal(cartasDeColor(mano).length, 0);
    });
});

describe('cartasDePoker', () => {
    it('detecta 4 del mismo valor', () => {
        const mano = [
            crearCarta('H', 10), crearCarta('D', 10),
            crearCarta('C', 10), crearCarta('S', 10),
            crearCarta('H', 2), crearCarta('D', 3), crearCarta('C', 4)
        ];
        const poker = cartasDePoker(mano);
        assert.equal(poker.length, 4);
        assert.ok(poker.every(c => c.value === 10));
    });
});

describe('obtenerResultadosVictoria — Color', () => {
    it('ganador por COLOR: etiqueta Color, 0 pts; carta sobrante visible en sueltas', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Ana', 'Bot']);

        // 7♥ de Color + 2♠ sin descartar (estado de la última jugada)
        game.jugadores[0].mano = [
            crearCarta('H', 1), crearCarta('H', 3), crearCarta('H', 5),
            crearCarta('H', 7), crearCarta('H', 9), crearCarta('H', 11),
            crearCarta('H', 13), crearCarta('S', 2)
        ];
        game.jugadores[0].gruposExpuestos = [];
        game.jugadores[0].tuvoRoboDescarte = false;
        game.mazoRecicladoUnaVez = false;
        game.juegoTerminado = false;

        game.verificarVictoriaEspecial(game.jugadores[0]);

        assert.equal(game.tipoVictoria, 'COLOR');
        assert.equal(game.ganadorId, 0);

        const ana = game.obtenerResultadosVictoria().find(r => r.id === 0);

        assert.equal(ana.esGanador, true);
        assert.equal(ana.jugadaEspecial, 'COLOR');
        assert.equal(ana.puntosSueltas, 0);
        assert.equal(ana.gruposArmados.length, 1);
        assert.equal(ana.gruposArmados[0].origen, 'color');
        assert.equal(ana.gruposArmados[0].etiqueta, 'Color');
        assert.equal(ana.gruposArmados[0].cartas.length, 7);
        assert.ok(ana.gruposArmados[0].cartas.every(c => c.suit === 'H'));
        assert.equal(ana.cartasSueltas.length, 1);
        assert.equal(ana.cartasSueltas[0].id, 'S2');
        assert.equal(ana.cartasSueltasText, '2♠');
    });
});

describe('obtenerResultadosVictoria — Póker', () => {
    it('ganador por POKER: etiqueta Póker, 0 pts; resto en sueltas', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Ana', 'Bot']);

        game.jugadores[0].mano = [
            crearCarta('H', 10), crearCarta('D', 10),
            crearCarta('C', 10), crearCarta('S', 10),
            crearCarta('H', 2), crearCarta('D', 3), crearCarta('C', 4)
        ];
        game.jugadores[0].gruposExpuestos = [];
        game.jugadores[0].tuvoRoboDescarte = false;
        game.mazoRecicladoUnaVez = false;
        game.juegoTerminado = false;

        game.verificarVictoriaEspecial(game.jugadores[0]);
        assert.equal(game.tipoVictoria, 'POKER');

        const ana = game.obtenerResultadosVictoria().find(r => r.id === 0);
        assert.equal(ana.jugadaEspecial, 'POKER');
        assert.equal(ana.gruposArmados[0].etiqueta, 'Póker');
        assert.equal(ana.puntosSueltas, 0);
        assert.equal(ana.gruposArmados[0].cartas.length, 4);
        assert.equal(ana.cartasSueltas.length, 3);
    });
});
