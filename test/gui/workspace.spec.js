import {test, expect} from '@playwright/test';
import {_electron as electron} from 'playwright';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';

let servidor;
let pasta;
let link;
let origin;
let key;
const root = resolve(import.meta.dirname, '../..');

test.beforeAll(async () => {
	pasta = await realpath(await mkdtemp(join(tmpdir(), 'hive-gui-test-')));
	await mkdir(join(pasta, 'bin'));
	const fake = `#!${process.execPath}
if (process.argv[2] === '--version') { console.log('9.8.7'); process.exit(); }
if (process.argv[2] === 'auth') { console.log(JSON.stringify({subscriptionType:'pro'})); process.exit(); }
if (process.argv[2] === 'app-server') {
 let rest=''; process.stdin.on('data', data => { rest+=data; let i; while((i=rest.indexOf('\\n'))>=0){const line=rest.slice(0,i);rest=rest.slice(i+1);try{const m=JSON.parse(line);console.log(JSON.stringify({id:m.id,result:m.method==='account/read'?{account:{type:'chatgpt',planType:'plus'}}:{rateLimits:{primary:{windowDurationMins:300,usedPercent:23,resetsAt:1999999999}}}}));}catch{}}});
} else {
 require(${JSON.stringify(join(root, 'test/agente-modelo.cjs'))});
}
`;
	for (const agent of ['claude', 'codex']) await writeFile(join(pasta, 'bin', agent), fake, {mode: 0o755});
	servidor = spawn(process.execPath, [join(root, 'gui/server.js')], {cwd: pasta, env: {...process.env, PATH: `${join(pasta, 'bin')}:${process.env.PATH}`, HIVE_GUI_NO_OPEN: '1', HIVE_GUI_PORT: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
	let stdout = ''; let stderr = '';
	servidor.stderr.on('data', data => { stderr += data; });
	link = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`Servidor não iniciou: ${stderr}`)), 15000);
		servidor.once('exit', code => { clearTimeout(timeout); reject(new Error(`Servidor saiu: ${code} ${stderr}`)); });
		servidor.stdout.on('data', data => { stdout += data; const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#\w+/)?.[0]; if (url) { clearTimeout(timeout); resolve(url); } });
	});
	origin = new URL(link).origin; key = new URL(link).hash.slice(1);
});
test.afterAll(async () => {
	if (servidor && servidor.exitCode === null) { const ended = once(servidor, 'exit'); servidor.kill('SIGTERM'); await ended; }
	if (pasta) await rm(pasta, {recursive: true, force: true});
});

test('interface gráfica conecta agentes, preserva rascunho e troca modelos', async ({page}) => {
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.goto(link);
	await expect(page.getByText('Conectado localmente')).toBeVisible();
	await expect(page.getByRole('heading', {name: /Boas ideias/})).toBeVisible();
	await expect(page.locator('#usage')).toContainText('Claude Code');
	await page.screenshot({path: join(root, 'docs/gui-inicio.png')});
	await page.getByRole('button', {name: 'Nova conversa', exact: true}).first().click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.getByLabel('Pasta do projeto', {exact: true})).toHaveValue(pasta);
	await page.getByRole('button', {name: 'Iniciar conversa'}).click();
	await expect(page.locator('#agent-name')).toHaveText('Claude Code');
	await expect(page.locator('#terminal .xterm-screen')).toContainText('AGENTE DE TESTE');
	await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('rascunho-preservado');
	await expect(page.locator('#terminal .xterm-screen')).toContainText('rascunho-preservado');
	await page.getByRole('button', {name: 'Nova conversa', exact: true}).first().click();
	await page.locator('.agent-choice.codex').click();
	await page.getByRole('button', {name: 'Iniciar conversa'}).click();
	await expect(page.locator('#agent-name')).toHaveText('Codex');
	await expect(page.locator('.conversation-card')).toHaveCount(2);
	await page.locator('.conversation-card').first().click();
	await expect(page.locator('#agent-name')).toHaveText('Claude Code');
	await expect(page.locator('#terminal .xterm-screen')).toContainText('rascunho-preservado');
	await page.getByRole('button', {name: /MODELO/}).click();
	await page.getByRole('radio', {name: /Sonnet/}).check();
	await page.getByRole('button', {name: 'Trocar modelo', exact: true}).click();
	await expect(page.locator('#model-dialog')).not.toBeVisible({timeout: 20000});
	await expect(page.locator('#model-name')).toHaveText('Sonnet 5.5');
	await expect(page.locator('#terminal .xterm-screen')).toContainText('rascunho-preservado');
	await expect(page.locator('.conversation-card')).toHaveCount(2);
	for (const indice of [0, 1]) {
		await page.locator('.conversation-card').nth(indice).click();
		const agente = indice === 0 ? 'Claude Code' : 'Codex';
		await expect(page.locator('#agent-name')).toHaveText(agente);
		if (indice === 1) {
			await page.locator('.xterm-helper-textarea').focus();
			await page.keyboard.type('rascunho-codex');
			await page.getByRole('button', {name: /MODELO/}).click();
			await page.locator('#custom-model').fill('gpt-6-astra');
			await page.getByRole('button', {name: 'Trocar modelo', exact: true}).click();
			await expect(page.locator('#model-dialog')).not.toBeVisible({timeout: 20000});
			await expect(page.locator('#model-name')).toHaveText('gpt-6-astra');
		}
		const modelo = await page.locator('#model-name').textContent();
		const panesAntes = execFileSync('tmux', ['-L', `hive-gui-${servidor.pid}`, 'list-panes', '-a', '-F', '#{pane_id} #{pane_pid} #{pane_current_path}'], {encoding: 'utf8'});
		await page.getByRole('button', {name: /MODELO/}).click();
		await page.locator('#custom-model').fill('indisponivel');
		await page.getByRole('button', {name: 'Trocar modelo', exact: true}).click();
		await expect(page.locator('#model-error')).toContainText('inválido ou indisponível', {timeout: 20000});
		await page.keyboard.press('Escape');
		await expect(page.locator('#model-name')).toHaveText(modelo);
		await expect(page.locator('#terminal .xterm-screen')).toContainText(indice === 0 ? 'rascunho-preservado' : 'rascunho-codex');
		await expect(page.locator('.conversation-card')).toHaveCount(2);
		expect(execFileSync('tmux', ['-L', `hive-gui-${servidor.pid}`, 'list-panes', '-a', '-F', '#{pane_id} #{pane_pid} #{pane_current_path}'], {encoding: 'utf8'})).toBe(panesAntes);
	}
	await page.locator('.conversation-card').first().click();
	await page.screenshot({path: join(root, 'docs/gui-conversa.png')});
	await page.getByRole('button', {name: 'Nova conversa', exact: true}).first().click();
	await page.screenshot({path: join(root, 'docs/gui-agentes.png')});
	await page.keyboard.press('Escape');
	await fetch(`${origin}/api/conversations`, {method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify({agente: 'claude', pasta})});
	await expect(page.locator('.conversation-card')).toHaveCount(3);
	// Atalhos com o foco no terminal: trocam de conversa sem enviar nada ao agente.
	const ativa = () => page.locator('.conversation-card').evaluateAll(cards => cards.findIndex(card => card.classList.contains('active')));
	await page.locator('.xterm-helper-textarea').focus();
	const inicio = await ativa();
	await page.keyboard.press('Alt+ArrowDown');
	await expect.poll(ativa).toBe((inicio + 1) % 3);
	await page.keyboard.press('Alt+ArrowUp');
	await expect.poll(ativa).toBe(inicio);
	await page.keyboard.press('Alt+ArrowUp');
	await expect.poll(ativa).toBe((inicio + 2) % 3);
	await page.keyboard.press('Alt+ArrowLeft');
	await expect.poll(ativa).toBe(inicio);
	await page.keyboard.press('Alt+KeyW');
	await expect(page.getByRole('heading', {name: 'Encerrar esta conversa?'})).toBeVisible();
	await page.getByRole('button', {name: 'Manter aberta'}).click();
	await expect(page.locator('.conversation-card')).toHaveCount(3);
	await page.getByRole('button', {name: 'Fechar conversa', exact: true}).click();
	await expect(page.getByRole('heading', {name: 'Encerrar esta conversa?'})).toBeVisible();
	await page.getByRole('button', {name: 'Manter aberta'}).click();
	await expect(page.locator('.conversation-card')).toHaveCount(3);
	await page.getByRole('button', {name: 'Fechar conversa', exact: true}).click();
	await page.getByRole('button', {name: 'Encerrar conversa', exact: true}).click();
	await expect.poll(async () => (await (await fetch(`${origin}/api/state`, {headers: {Authorization: `Bearer ${key}`}})).json()).conversas.length).toBe(2);
	await expect(page.locator('.conversation-card')).toHaveCount(2);
	expect(execFileSync('tmux', ['-L', `hive-gui-${servidor.pid}`, 'list-sessions', '-F', '#{session_name}'], {encoding: 'utf8'})).not.toContain('conversa-3');
	await page.getByRole('searchbox', {name: 'Buscar conversa'}).fill('não existe');
	await expect(page.getByText('Nenhuma conversa encontrada.')).toBeVisible();
	await page.getByRole('searchbox', {name: 'Buscar conversa'}).fill('');
	await page.reload();
	await expect(page.locator('.conversation-card')).toHaveCount(2);
	await page.setViewportSize({width: 800, height: 640});
	await expect(page.getByRole('button', {name: /MODELO/})).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
	expect(errors).toEqual([]);
});

test('terminal cabe na área visível e envia as dimensões corretas ao redimensionar', async ({page}) => {
	// Isola a renderização das repinturas assíncronas do tmux.
	await page.routeWebSocket('**/terminal?**', () => {});
	await page.addInitScript(() => {
		const send = WebSocket.prototype.send;
		WebSocket.prototype.send = function (data) {
			try {
				const message = JSON.parse(data);
				if (message.tipo === 'tamanho') window.ultimoTamanho = message;
			} catch {}
			return send.call(this, data);
		};
	});
	await page.goto(link);
	await expect(page.locator('.conversation-card')).toHaveCount(2);
	await page.locator('.conversation-card').first().click();

	async function verificarDimensoes() {
		await expect.poll(() => page.evaluate(() => {
			const host = document.getElementById('terminal').getBoundingClientRect();
			const screen = document.querySelector('.xterm-screen')?.getBoundingClientRect();
			const section = document.getElementById('terminal-section').getBoundingClientRect();
			const size = window.ultimoTamanho;
			if (!screen || !size) return ['aguardando terminal'];
			return Object.entries({
				conteudo: screen.width > 0 && screen.height > 0,
				largura: screen.left >= host.left && screen.right <= host.right + 0.5,
				altura: screen.top >= host.top && screen.bottom <= host.bottom + 0.5,
				secao: host.bottom <= section.bottom && section.bottom <= innerHeight,
				janela: document.documentElement.scrollHeight <= innerHeight,
				dimensoes: size.colunas === terminal.cols && size.linhas === terminal.rows,
			}).filter(([, ok]) => !ok).map(([name]) => `${name}: ${innerWidth}x${innerHeight}, tela=${screen.width}x${screen.height}, area=${host.width}x${host.height}`);
		})).toEqual([]);
		await page.locator('.xterm-helper-textarea').focus();
		// Desenha na última célula para verificar também a linha inferior e o cursor.
		await page.evaluate(() => new Promise(resolve => {
			terminal.write(`\x1b[${terminal.rows};1HULTIMA LINHA\x1b[${terminal.rows};${terminal.cols}H`, resolve);
		}));
		await expect(page.locator('.xterm-rows > div').last()).toContainText('ULTIMA LINHA');
		await expect.poll(() => page.evaluate(() => {
			const cursor = document.querySelector('.xterm-cursor')?.getBoundingClientRect();
			const host = document.getElementById('terminal').getBoundingClientRect();
			return Boolean(cursor && cursor.bottom <= host.bottom + 0.5 && cursor.right <= host.right + 0.5);
		})).toBe(true);
	}

	for (const viewport of [{width: 1440, height: 960}, {width: 1024, height: 600}, {width: 800, height: 480}, {width: 640, height: 420}, {width: 1600, height: 900}]) {
		await page.setViewportSize(viewport);
		await verificarDimensoes();
		await page.locator('#toggle-sidebar').click();
		await verificarDimensoes();
		await page.locator('#toggle-sidebar').click();
		await page.locator('.conversation-card').nth(1).click();
		await expect(page.locator('#agent-name')).toHaveText('Codex');
		await verificarDimensoes();
		await page.locator('.conversation-card').first().click();
		await expect(page.locator('#agent-name')).toHaveText('Claude Code');
		await verificarDimensoes();
	}
});

test('protege comandos locais e rejeita parâmetros inválidos', async ({request, page}) => {
	expect((await request.get(`${origin}/api/state`)).status()).toBe(401);
	expect((await request.post(`${origin}/api/conversations`, {headers: {Authorization: `Bearer ${key}`}, data: {agente: 'shell'}})).status()).toBe(400);
	expect((await request.post(`${origin}/api/conversations`, {headers: {Authorization: `Bearer ${key}`}, data: {agente: 'claude', modelo: 'opus; touch /tmp/invalido'}})).status()).toBe(400);
	expect((await request.get(`${origin}/api/state`, {headers: {Authorization: `Bearer ${key}`, Origin: 'https://outro-site.example'}})).status()).toBe(403);
	await page.goto(link);
	await expect(page.getByText('Conectado localmente')).toBeVisible();
	await page.getByRole('button', {name: 'Nova conversa', exact: true}).first().click();
	await page.getByLabel('Pasta do projeto', {exact: true}).fill('/pasta-que-nao-existe-hive');
	await page.getByRole('button', {name: 'Iniciar conversa'}).click();
	await expect(page.getByRole('alert').filter({hasText: /pasta existente/})).toBeVisible();
});

test('hooks atualizam status, modelo e uso; sair do agente encerra somente sua conversa', async ({page}) => {
	await page.goto(link);
	await expect(page.locator('.conversation-card')).toHaveCount(2);
	await page.locator('.conversation-card').first().click();
	const socket = `hive-gui-${servidor.pid}`;
	const pane = execFileSync('tmux', ['-L', socket, 'list-panes', '-t', '=conversa-1', '-F', '#{pane_id}'], {encoding: 'utf8'}).trim();
	const socketPath = execFileSync('tmux', ['-L', socket, 'display-message', '-p', '#{socket_path}'], {encoding: 'utf8'}).trim();
	const env = {...process.env, TMUX: `${socketPath},0,1`, TMUX_PANE: pane, HIVE_GUI: '1'};
	execFileSync(process.execPath, [join(root, 'sidebar/status.js'), 'trabalhando'], {env, input: JSON.stringify({hook_event_name: 'UserPromptSubmit', prompt: 'Organiza o projeto'})});
	expect(execFileSync('tmux', ['-L', socket, 'show-options', '-pqv', '-t', pane, '@status'], {encoding: 'utf8'}).trim()).toBe('trabalhando');
	await expect(page.locator('#agent-status')).toHaveText('Trabalhando');
	await expect(page.locator('.conversation-card').first()).toContainText('Organiza o projeto');
	await expect.poll(async () => (await (await fetch(`${origin}/api/state`, {headers: {Authorization: `Bearer ${key}`}})).json()).conversas.find(c => c.id === 'conversa-1').enviadas).toBe(1);
	execFileSync(process.execPath, [join(root, 'sidebar/uso.js')], {env, input: JSON.stringify({model: {display_name: 'Sonnet (teste)'}, rate_limits: {five_hour: {used_percentage: 12, resets_at: 1999999999}}, cost: {total_lines_added: 9, total_lines_removed: 2}})});
	expect(execFileSync('tmux', ['-L', socket, 'show-options', '-pqv', '-t', pane, '@modelo'], {encoding: 'utf8'}).trim()).toBe('Sonnet (teste)');
	await expect(page.locator('#model-name')).toHaveText('Sonnet (teste)');
	await expect(page.locator('#usage')).toContainText('12% / 5h');
	await expect(page.locator('.conversation-card').first()).toContainText('+9');
	execFileSync(process.execPath, [join(root, 'sidebar/status.js'), 'pronto'], {env, input: '{}'});
	await expect(page.locator('#agent-status')).toHaveText('Pronto');
	await page.locator('.xterm-helper-textarea').focus();
	await page.keyboard.press('Control+d');
	await expect(page.locator('.conversation-card')).toHaveCount(1);
	await expect(page.locator('#agent-name')).toHaveText('Codex');
});

test('a interface abre em uma janela própria e o terminal funciona nela', async () => {
	const ambiente = {...process.env};
	delete ambiente.ELECTRON_RUN_AS_NODE;
	const aplicativo = await electron.launch({args: [join(root, 'gui/window.cjs'), link], env: ambiente});
	try {
		const janela = await aplicativo.firstWindow();
		await expect(janela).toHaveTitle('Hive · seu espaço de trabalho');
		await expect(janela.getByText('Conectado localmente')).toBeVisible();
		expect(await aplicativo.evaluate(({BrowserWindow}) => {
			const janela = BrowserWindow.getAllWindows()[0];
			const preferencias = janela.webContents.getLastWebPreferences();
			return {titulo: janela.getTitle(), node: preferencias.nodeIntegration, sandbox: preferencias.sandbox};
		})).toEqual({titulo: 'Hive', node: false, sandbox: true});
		await janela.getByRole('button', {name: 'Nova conversa', exact: true}).first().click();
		await janela.locator('.agent-choice.claude').click();
		await janela.getByRole('button', {name: 'Iniciar conversa'}).click();
		await expect(janela.locator('#agent-name')).toHaveText('Claude Code');
		await expect(janela.locator('#terminal .xterm-screen')).toContainText('AGENTE DE TESTE');
		await janela.locator('.xterm-helper-textarea').focus();
		await janela.keyboard.type('janela-local-funcionando');
		await expect(janela.locator('#terminal .xterm-screen')).toContainText('janela-local-funcionando');
		await janela.screenshot({path: join(root, 'docs/gui-aplicativo.png')});
	} finally { await aplicativo.close(); }
});
