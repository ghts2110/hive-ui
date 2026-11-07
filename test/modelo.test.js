import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {validarModelo, validarDisponibilidade, validarVersao, trocarModelo, detectarModelo} from '../sidebar/modelo.js';

test('aceita aliases e IDs dos dois agentes sem permitir comandos adicionais', () => {
	for (const modelo of ['', 'opus', 'sonnet', 'gpt-6.1-sol', 'provider/model:version', 'opus[1m]']) {
		assert.equal(validarModelo(modelo), modelo);
	}
	for (const modelo of [undefined, null, {}, 'sonnet\n/clear', 'opus;exit', '--help', 'a'.repeat(201)]) {
		assert.throws(() => validarModelo(modelo), /ID de modelo inválido/);
	}
});

function sessao(agente, {falha = false, status = ''} = {}) {
	const comandos = [];
	const opcoes = new Map([['@modelo_bridge', '1'], ['@agente_versao', '9.9.9'], ['@modelo', 'anterior'], ['@status', status]]);
	let tela = agente === 'claude' ? '❯ rascunho\n────────────────\n' : '› rascunho\n';
	let rascunho = 'texto\ncom várias linhas e acentos';
	let editor = 0;
	const tmux = (...args) => {
		if (args.includes(';')) {
			let grupo = [];
			for (const argumento of [...args, ';']) {
				if (argumento === ';') { tmux(...grupo); grupo = []; }
				else grupo.push(argumento);
			}
			return '';
		}
		comandos.push(args);
		if (args[0] === 'capture-pane') return tela;
		if (args[0] === 'show') return opcoes.get(args.at(-1)) || '';
		if (args[0] === 'set') {
			if (args[1] === '-pu') opcoes.delete(args.at(-1));
			else opcoes.set(args.at(-2), args.at(-1));
		}
		if (args[0] === 'send-keys' && args.at(-1) === 'C-g') {
			const pasta = opcoes.get('@modelo_pedido');
			if (editor++ === 0) {
				writeFileSync(join(pasta, 'rascunho'), rascunho);
				writeFileSync(join(pasta, 'preparado'), '');
				tela = `› /model ${JSON.parse(readFileSync(join(pasta, 'pedido.json'))).modelo}\n`;
			} else {
				rascunho = readFileSync(join(pasta, 'rascunho'), 'utf8');
				writeFileSync(join(pasta, 'restaurado'), '');
			}
		}
		if (args[0] === 'send-keys' && args.at(-1) === 'Enter') {
			tela = falha ? "Model 'indisponivel' is unavailable"
				: agente === 'claude' ? 'Set model to Sonnet 5.5 and saved as your default for new sessions'
				: 'Model changed to gpt-6.1-sol low for this session only';
		}
		return '';
	};
	return {tmux, comandos, opcoes, rascunho: () => rascunho, editor: () => editor};
}

for (const agente of ['claude', 'codex']) {
	test(`${agente}: troca no mesmo pane, restaura texto e só publica modelo confirmado`, async () => {
		const s = sessao(agente);
		const resultado = await trocarModelo({pane: '%42', agente, modelo: agente === 'claude' ? 'sonnet' : 'gpt-6.1-sol', tmux: s.tmux});
		assert.equal(s.opcoes.get('@modelo'), resultado);
		assert.equal(s.rascunho(), 'texto\ncom várias linhas e acentos');
		assert.equal(s.editor(), 2);
		assert.equal(s.opcoes.has('@modelo_pedido'), false);
		assert.equal(s.comandos.some(args => /new-|kill-|respawn/.test(args[0])), false);
		assert.deepEqual(s.comandos.at(-1), ['select-pane', '-e', '-t', '%42']);
	});
	test(`${agente}: falha mantém modelo anterior e restaura rascunho`, async () => {
		const s = sessao(agente, {falha: true});
		await assert.rejects(trocarModelo({pane: '%42', agente, modelo: 'indisponivel', tmux: s.tmux}), /inválido ou indisponível/);
		assert.equal(s.opcoes.get('@modelo'), 'anterior');
		assert.equal(s.editor(), 2);
		assert.equal(s.rascunho(), 'texto\ncom várias linhas e acentos');
	});
	test(`${agente}: escolher o mesmo modelo não envia teclas`, async () => {
		const s = sessao(agente);
		await trocarModelo({pane: '%42', agente, modelo: 'anterior', tmux: s.tmux});
		assert.equal(s.comandos.some(args => args[0] === 'send-keys'), false);
	});
}

test('identifica o modelo informado pelos cabeçalhos das versões instaladas', () => {
	assert.equal(detectarModelo('  GPT-6.1-Sol low · ~/projeto', 'codex'), 'gpt-6.1-sol');
	assert.equal(detectarModelo('▝▜  Sonnet 5.5 · Claude Pro', 'claude'), 'Sonnet 5.5');
});

test('recusa troca durante resposta ou interação sem modificar a sessão', () => {
	assert.throws(() => validarDisponibilidade('trabalhando'), /Aguarde a resposta/);
	assert.throws(() => validarDisponibilidade('esperando'), /interação pendente/);
	assert.doesNotThrow(() => validarDisponibilidade('pronto'));
});

for (const agente of ['claude', 'codex']) {
	for (const status of ['trabalhando', 'esperando']) {
		test(`${agente}: não envia comandos enquanto está ${status}`, async () => {
			const s = sessao(agente, {status});
			await assert.rejects(trocarModelo({pane: '%42', agente, modelo: 'outro', tmux: s.tmux}), /Aguarde|pendente/);
			assert.equal(s.editor(), 0);
			assert.equal(s.opcoes.get('@modelo'), 'anterior');
		});
	}
}

test('versões sem o protocolo validado são recusadas antes de editar o rascunho', () => {
	assert.throws(() => validarVersao('claude', '2.1.310'), /2.1.311/);
	assert.throws(() => validarVersao('codex', '0.166.0'), /0.167.0/);
	assert.throws(() => validarVersao('codex', ''), /0.167.0/);
	assert.doesNotThrow(() => validarVersao('claude', 'Claude Code 2.1.311'));
	assert.doesNotThrow(() => validarVersao('codex', 'codex-cli 0.167.0'));
});
