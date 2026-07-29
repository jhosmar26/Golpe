/**
 * Enchufes en la tabla final: deben verse explícitos (etiqueta «Enchufe»).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearCarta, optimizarMano, GolpeadoGame } from '../../game.js';

describe('tabla final — enchufes visibles', () => {
    it('muestra el enchufe del ganador (CERO_EXPUESTO) además de los grupos de mesa', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Jugador', 'Bot Ana']);
        game.juegoTerminado = true;
        game.ganadorId = 1;
        game.tipoVictoria = 'CERO_EXPUESTO';

        // Mesa de Ana: trío de 5s + escalera 7-8-9♦; en mano solo 10♦ (enchufa a la escalera)
        game.jugadores[1].gruposExpuestos = [
            [crearCarta('C', 5), crearCarta('S', 5), crearCarta('H', 5)],
            [crearCarta('D', 7), crearCarta('D', 8), crearCarta('D', 9)]
        ];
        game.jugadores[1].mano = [crearCarta('D', 10)];
        game.jugadores[0].mano = [
            crearCarta('D', 12), crearCarta('C', 12), crearCarta('H', 12),
            crearCarta('D', 2), crearCarta('D', 6), crearCarta('D', 5), crearCarta('D', 1)
        ];
        game.jugadores[0].gruposExpuestos = [];

        const ana = game.obtenerResultadosVictoria().find(r => r.id === 1);
        assert.equal(ana.puntosSueltas, 0);
        assert.equal(ana.cartasSueltas.length, 0);
        assert.equal(ana.grupos, 2, '2 grupos de mesa');
        assert.equal(ana.enchufes, 1, '1 enchufe (10♦)');
        assert.equal(ana.gruposArmados.length, 3);

        const enchufe = ana.gruposArmados.find(g => g.origen === 'enchufe');
        assert.ok(enchufe);
        assert.equal(enchufe.etiqueta, 'Enchufe');
        assert.equal(enchufe.cartas[0].id, 'D10');
        assert.match(enchufe.sobreGrupo, /7♦/);

        // Jugador: trío de Q + enchufes 5♦/6♦ + sueltas
        const yo = game.obtenerResultadosVictoria().find(r => r.id === 0);
        assert.ok(yo.enchufes >= 1);
        assert.ok(yo.gruposArmados.some(g => g.origen === 'enchufe'));
        assert.equal(yo.puntosSueltas, 13);
    });

    it('optimizarMano marca el enchufe de 10♦ sobre 7-8-9♦', () => {
        const mesa = [[crearCarta('D', 7), crearCarta('D', 8), crearCarta('D', 9)]];
        const opt = optimizarMano([crearCarta('D', 10)], mesa);
        assert.equal(opt.puntos, 0);
        assert.equal(opt.enchufes.length, 1);
        assert.equal(opt.enchufes[0].carta.id, 'D10');
        assert.equal(opt.sueltas.length, 0);
    });
});
