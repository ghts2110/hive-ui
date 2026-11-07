import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as pausa} from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
async function esperar(verificar) {
	const limite = Date.now() + 12000;
	while (Date.now() < limite) {
		if (verificar()) return;
		await pausa(100);
	}
	assert.fail('O cabeçalho não concluiu a ação no prazo.');
}

for (const agente of ['claude', 'codex']) {
	test(`cabeçalho ${agente}: mantém pane, processo, título, pasta e rascunho`, {timeout: 45000}, async () => {
		const pasta = await mkdtemp(join(tmpdir(), 'hive-terminal-modelo-'));
		const socket = `hive-modelo-${process.pid}-${agente}`;
		const tmux = (...args) => execFileSync('tmux', ['-L', socket, ...args], {encoding: 'utf8', timeout: 4000, stdio: 'pipe'}).trim();
		const fake = join(pasta, 'agente');
		await writeFile(fake, `#!${process.execPath}\nif(process.argv[2]==='--version'){console.log('9.9.9');process.exit();}\nif(process.argv[2]==='auth'){console.log('{}');process.exit();}\nrequire(${JSON.stringify(join(root, 'test/agente-modelo.cjs'))});\n`, {mode: 0o755});
		try {
			const sidebar = tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'teste', '-x', '150', '-y', '40',
				'-e', `HIVE_ROOT=${root}`, '-e', `HIVE_NODE=${process.execPath}`, '-e', `HIVE_CLAUDE=${fake}`,
				'-e', `HIVE_IA=${agente}`, '-e', 'HIVE_GUI=1', '-e', `PATH=${pasta}:${process.env.PATH}`,
				'-P', '-F', '#{pane_id}', 'sleep', '300');
			// O launcher procura o Codex pelo PATH; ambos usam a mesma TUI de teste.
			await writeFile(join(pasta, 'codex'), await readFile(fake), {mode: 0o755});
			tmux('set', '-g', '@sidebar', sidebar);
			const pane = tmux('split-window', '-h', '-t', sidebar, '-c', pasta, '-P', '-F', '#{pane_id}', join(root, 'bin/conversa'));
			const cabecalho = tmux('split-window', '-v', '-b', '-l', '3', '-t', pane, '-P', '-F', '#{pane_id}', process.execPath, join(root, 'sidebar/cabecalho.js'));
			tmux('set', '-g', '@cabecalho', cabecalho);
			await esperar(() => tmux('capture-pane', '-p', '-t', cabecalho).includes('Trocar modelo'));
			tmux('set', '-p', '-t', pane, '@titulo', 'Título preservado');
			tmux('send-keys', '-t', pane, '-l', 'rascunho-terminal');
			await esperar(() => tmux('capture-pane', '-p', '-t', pane).includes('rascunho-terminal'));
			const identidade = () => tmux('display', '-p', '-t', pane, '#{pane_id}|#{pane_pid}|#{@conversa}|#{@titulo}|#{pane_current_path}');
			const antes = identidade();
			const panes = tmux('list-panes', '-a', '-F', '#{pane_id}');
			const escolher = async modelo => {
				tmux('select-pane', '-t', cabecalho);
				tmux('send-keys', '-t', cabecalho, 'm');
				await pausa(150);
				tmux('send-keys', '-t', cabecalho, 'i');
				await pausa(150);
				tmux('send-keys', '-t', cabecalho, '-l', modelo);
				tmux('send-keys', '-t', cabecalho, 'Enter');
			};
			const modelo = agente === 'claude' ? 'sonnet' : 'gpt-6-astra';
			await escolher(modelo);
			await esperar(() => tmux('show', '-pqv', '-t', pane, '@modelo') === (agente === 'claude' ? 'Sonnet 5.5' : modelo));
			await esperar(() => !tmux('show', '-pqv', '-t', pane, '@modelo_pedido'));
			assert.equal(identidade(), antes);
			assert.equal(tmux('list-panes', '-a', '-F', '#{pane_id}'), panes);
			assert.match(tmux('capture-pane', '-p', '-t', pane), /rascunho-terminal/);
			await escolher('indisponivel');
			await esperar(() => tmux('capture-pane', '-p', '-t', cabecalho).includes('indisponível'));
			assert.equal(identidade(), antes);
			assert.equal(tmux('list-panes', '-a', '-F', '#{pane_id}'), panes);
			assert.match(tmux('capture-pane', '-p', '-t', pane), /rascunho-terminal/);
		} finally {
			try { tmux('kill-server'); } catch {}
			await rm(pasta, {recursive: true, force: true});
		}
	});
}
