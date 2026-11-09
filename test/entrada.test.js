import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interrompeLeitura} from '../gui/entrada.js';

test('Esc e Ctrl+C continuam interrompendo a leitura', () => {
	assert.equal(interrompeLeitura('\x1b'), true);
	assert.equal(interrompeLeitura('\x03'), true);
});

test('mouse e troca de foco não interrompem a leitura', () => {
	for (const dados of [
		'\x1b[I', '\x1b[O', // foco recebido e perdido
		'\x1b[<35;12;8M', '\x1b[<0;12;8M', '\x1b[<0;12;8m', // movimento e clique
		'\x1b[<64;12;8M', '\x1b[M !!', // rolagem e mouse legado
		'\x1b[I\x1b[<35;12;8M',
	]) assert.equal(interrompeLeitura(dados), false, JSON.stringify(dados));
});

test('navegação, respostas do terminal e texto colado não interrompem a leitura', () => {
	for (const dados of [
		'\x1b[A', '\x1b[B', '\x1b[1;5D', '\x1bOP', '\x1ba',
		'\x1b[12;8R', '\x1b[?1;2c', '\x1b[200~texto\x1b[201~',
		'texto', '\r', '',
	]) assert.equal(interrompeLeitura(dados), false, JSON.stringify(dados));
});
