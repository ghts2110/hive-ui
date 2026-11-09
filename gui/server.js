import {createServer} from 'node:http';
import {execFileSync, execFile, spawn} from 'node:child_process';
import {readFile, stat, mkdtemp, writeFile} from 'node:fs/promises';
import {existsSync, statSync, chmodSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {WebSocketServer} from 'ws';
import * as pty from 'node-pty';
import {topico} from '../sidebar/conversas.js';
import {trocarModelo, detectarModelo} from '../sidebar/modelo.js';
import * as voz from '../sidebar/voz.js';
import {interrompeLeitura} from './entrada.js';
import {Ditado, comoResolver} from '../sidebar/ditado.js';
import * as plano from '../sidebar/plano.js';

const executar = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// O prebuild do node-pty para macOS pode chegar do npm sem o bit executável.
// Corrige somente o helper instalado, antes de abrir qualquer pseudoterminal.
if (process.platform === 'darwin') {
	const pacote = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
	for (const relativo of ['build/Release/spawn-helper', `prebuilds/darwin-${process.arch}/spawn-helper`]) {
		const helper = join(pacote, relativo);
		if (existsSync(helper) && !(statSync(helper).mode & 0o100)) chmodSync(helper, statSync(helper).mode | 0o100);
	}
}
const pastaInicial = process.cwd();

// Imagens coladas ou soltas viram arquivos temporários; o agente recebe o caminho, como ao arrastar no terminal.
const limiteImagem = 20 * 1024 * 1024;
let pastaImagens;
function extensaoImagem(b) {
	if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
	if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
	if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
}
async function salvarImagem(req) {
	const partes = []; let total = 0;
	for await (const parte of req) { total += parte.length; if (total > limiteImagem) throw new Error('Imagem muito grande (máximo de 20 MB).'); partes.push(parte); }
	const bytes = Buffer.concat(partes), extensao = extensaoImagem(bytes);
	if (!extensao) throw new Error('Formato não suportado. Use PNG, JPEG, GIF ou WebP.');
	pastaImagens ||= await mkdtemp(join(tmpdir(), 'hive-imagens-'));
	const caminho = join(pastaImagens, `imagem-${Date.now()}-${randomBytes(3).toString('hex')}.${extensao}`);
	await writeFile(caminho, bytes, {mode: 0o600});
	return caminho;
}
const chave = randomBytes(32).toString('hex');
const socket = `hive-gui-${process.pid}`;
const tmux = (...args) => execFileSync('tmux', ['-L', socket, ...args], {encoding: 'utf8', stdio: 'pipe', timeout: 4000}).trim();
const binario = nome => {
	try { return execFileSync('sh', ['-c', `command -v ${nome}`], {encoding: 'utf8', stdio: 'pipe'}).trim(); } catch { return ''; }
};
const agentes = Object.fromEntries(['claude', 'codex'].map(id => [id, {id, nome: id === 'claude' ? 'Claude Code' : 'Codex', caminho: binario(id), versao: '', plano: ''}]));
const conversas = new Map();
let ativa = null;
let anterior = null;
let numero = 0;
let origem;
let finalizando = false;
let leitor = null;
let buscandoVoz = false;
let aviso = '';
let microfone = {fase: 'desligado'};
let falando = false;
const leituraPlano = new AbortController();

// Socket separado: nunca acessa sessões ou configurações tmux do usuário.
try {
	tmux('-f', join(root, 'gui/tmux.conf'), 'new-session', '-d', '-s', 'controle', '--', process.execPath, join(root, 'gui/controle.js'));
	process.env.TMUX = `${tmux('display-message', '-p', '#{socket_path}')},0,0`;
	tmux('set', '-g', '@gui_pid', String(process.pid));
} catch {
	console.error('hive: não foi possível abrir o tmux. Confira se ele está instalado.');
	process.exit(1);
}

const ditado = new Ditado(() => conversas.get(ativa)?.pane, estado => {
	microfone = estado;
	if (estado.aviso) aviso = comoResolver[estado.aviso]?.join(' ') || ({baixar: 'Não foi possível baixar o ditado.', silencio: 'Ditado pausado após silêncio.', falhou: 'O ditado falhou. Tente novamente.'}[estado.aviso] || estado.aviso);
	if (leitor) { leitor.mudo = estado.fase !== 'desligado'; if (leitor.mudo) leitor.calar(); }

});

async function identificar() {
	await Promise.all(Object.values(agentes).map(async agente => {
		if (!agente.caminho) return;
		try { agente.versao = (await executar(agente.caminho, ['--version'], {timeout: 4000})).stdout.match(/\d+\.\d+\.\d+\S*/)?.[0] || ''; } catch {}
	}));
	if (agentes.claude.caminho) {
		try {
			const dados = JSON.parse((await executar(agentes.claude.caminho, ['auth', 'status'], {timeout: 5000})).stdout);
			agentes.claude.plano = ({pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise'})[dados.subscriptionType] || (dados.authMethod?.startsWith('api_key') ? 'API' : '');
		} catch {}
	}

}
async function usoCodex() {
	if (!agentes.codex.caminho || finalizando) return;
	const dados = await plano.ler(agentes.codex.caminho, leituraPlano.signal);
	agentes.codex.plano = dados.plano ? `ChatGPT ${dados.plano}` : dados.conta === 'apiKey' ? 'API' : '';
	agentes.codex.uso = dados.uso || '';

}

function selecionar(id) {
	const conversa = conversas.get(id);
	if (!conversa) throw new Error('Conversa encerrada.');
	if (ativa !== id) { anterior = ativa; ditado.desligar(true); leitor?.calar(); }
	ativa = id;
	tmux('set', '-g', '@sidebar', conversa.pane);
	tmux('set', '-pu', '-t', conversa.pane, '@novo');
	leitor?.seguir(conversa.transcript);

}

async function criar({agente, modelo = '', pasta}) {
	if (!['claude', 'codex'].includes(agente)) throw new Error('Escolha um agente válido.');
	if (!agentes[agente].caminho) throw new Error(`${agentes[agente].nome} não encontrado no PATH. Instale e faça login pelo terminal.`);
	if (typeof modelo !== 'string' || (modelo && !/^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]{0,199}$/.test(modelo))) throw new Error('ID de modelo inválido.');
	pasta = pasta || conversas.get(ativa)?.pasta || pastaInicial;
	if (typeof pasta !== 'string' || !pasta.startsWith('/') || !(await stat(pasta).catch(() => null))?.isDirectory()) throw new Error('Escolha uma pasta existente pelo caminho completo.');
	const id = `conversa-${++numero}`;
	const pane = tmux('new-session', '-d', '-s', id, '-x', '110', '-y', '32', '-c', pasta,
		'-e', 'HIVE=1', '-e', 'HIVE_GUI=1', '-e', `HIVE_ROOT=${root}`, '-e', `HIVE_NODE=${process.execPath}`,
		'-e', `HIVE_CLAUDE=${agentes.claude.caminho}`, '-e', `HIVE_IA=${agente}`, '-e', `HIVE_MODELO=${modelo}`,
		'-P', '-F', '#{pane_id}', '--', join(root, 'bin/conversa'));
	tmux('set', '-p', '-t', pane, '@ia', agente);
	conversas.set(id, {id, pane, agente, pasta, modelo, titulo: 'Nova conversa', status: '', desde: 0, novo: false});
	selecionar(id);
	return id;
}

function estado() {
	return {ativa, pasta: pastaInicial, conversas: [...conversas.values()].map(({transcript, pane, ...item}) => item),
		agentes: Object.values(agentes).map(({caminho, ...item}) => ({...item, instalado: Boolean(caminho)})),
		voz: {ligada: Boolean(leitor), preparando: buscandoVoz, falando}, microfone, aviso};
}
function atualizar() {
	if (finalizando) return;
	try {
		const panes = new Map(tmux('list-panes', '-a', '-F', '#{pane_id}\t#{pane_current_path}\t#{@modelo}\t#{@status}\t#{@desde}\t#{@novo}\t#{@titulo}\t#{pane_title}\t#{@topico_velho}\t#{@transcript}\t#{@linhas}\t#{@uso}\t#{@enviadas}').split('\n').map(l => { const [id, ...dados] = l.split('\t'); return [id, dados]; }));
		for (const [id, c] of conversas) {
			const dados = panes.get(c.pane);
			if (!dados) { conversas.delete(id); continue; }
			const [pasta, modelo, status, desde, novo, titulo, painel, velho, transcript, linhas] = dados;
			Object.assign(c, {pasta, modelo: modelo || c.modelo, status, desde: Number(desde) || 0, novo: novo === '1',
				titulo: (topico(painel, c.agente) !== topico(velho, c.agente) && topico(painel, c.agente)) || titulo || 'Nova conversa', transcript,
				linhas: linhas ? linhas.split(' ').map(Number) : null});
			if (id === ativa) {
				leitor?.seguir(transcript);
				const enviadas = Number(dados[11]) || 0;
				if (c.enviadas !== undefined && c.enviadas !== enviadas) { ditado.desligar(true); leitor?.calar(); }
				c.enviadas = enviadas;
			}
			if (!modelo && c.agente === 'codex') {
				const tela = tmux('capture-pane', '-p', '-t', c.pane, '-S', '-50');
				const detectado = detectarModelo(tela, c.agente);
				if (detectado) c.modelo = detectado;
			}
		}
		agentes.claude.uso = tmux('show', '-gqv', '@uso');
		if (ativa && !conversas.has(ativa)) {
			ativa = null;
			if (conversas.size) selecionar(conversas.keys().next().value);
			else { leitor?.seguir(undefined); ditado.desligar(true); }
		}
		ditado.descarregar();
		leitor?.ler();

	} catch (erro) { if (!finalizando) console.error('hive: leitura da interface:', erro.message); }
}

async function alternarVoz() {
	if (buscandoVoz) return;
	if (leitor) { leitor.calar(); leitor = null; return; }
	buscandoVoz = true;
	try {
		const encontrada = await voz.procurarVoz();
		if (!encontrada && !voz.suportaNatural) throw new Error(voz.comoInstalar.join(' '));
		leitor = new voz.Leitor(encontrada, valor => { falando = valor; }, () => { aviso = 'A voz falhou. Desligue e ligue a leitura para tentar novamente.'; });
		leitor.mudo = microfone.fase !== 'desligado';
		leitor.seguir(conversas.get(ativa)?.transcript);
		if (!encontrada?.natural && voz.suportaNatural) {
			aviso = 'Baixando voz natural; a conversa continua disponível.';
			const atual = leitor;
			voz.baixarNatural().then(natural => {
				if (leitor !== atual) return;
				if (natural) { leitor.voz = natural; aviso = ''; }
				else { aviso = 'Não foi possível baixar a voz natural.'; if (!encontrada) leitor = null; }

			});
		}
	} finally { buscandoVoz = false; }
}

const arquivos = new Map([
	['/', ['gui/index.html', 'text/html']], ['/app.js', ['gui/app.js', 'text/javascript']], ['/style.css', ['gui/style.css', 'text/css']],
	['/vendor/xterm.js', ['node_modules/@xterm/xterm/lib/xterm.js', 'text/javascript']],
	['/vendor/xterm.css', ['node_modules/@xterm/xterm/css/xterm.css', 'text/css']],
	['/vendor/fit.js', ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'text/javascript']],
]);
const json = (res, codigo, dados) => { res.writeHead(codigo, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(dados)); };
const autorizado = req => req.headers.authorization === `Bearer ${chave}`;
const servidor = createServer(async (req, res) => {
	if (req.headers.host !== new URL(origem).host || (req.headers.origin && req.headers.origin !== origem)) return json(res, 403, {erro: 'Origem inválida.'});
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
	const url = new URL(req.url, origem);
	try {
		if (url.pathname.startsWith('/api/')) {
			if (!autorizado(req)) return json(res, 401, {erro: 'Abra o link exibido pelo hive no terminal.'});
			if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, estado());
			if (req.method !== 'POST') return json(res, 405, {erro: 'Método inválido.'});
			if (url.pathname === '/api/image') return json(res, 201, {caminho: await salvarImagem(req)});
			let corpo = ''; for await (const parte of req) { corpo += parte; if (corpo.length > 16000) return json(res, 413, {erro: 'Pedido muito grande.'}); }
			const dados = JSON.parse(corpo || '{}');
			if (url.pathname === '/api/conversations') return json(res, 201, {id: await criar(dados)});
			if (url.pathname !== '/api/action') return json(res, 404, {erro: 'Ação desconhecida.'});
			if (dados.acao === 'modelo') {
				const c = conversas.get(dados.id);
				if (!c) throw new Error('Conversa encerrada.');
				c.modelo = await trocarModelo({pane: c.pane, agente: c.agente, modelo: dados.modelo, tmux});
			}
			else if (dados.acao === 'selecionar') selecionar(dados.id);
			else if (dados.acao === 'fechar') {
				const c = conversas.get(dados.id); if (!c) throw new Error('Conversa encerrada.');
				tmux('kill-session', '-t', `=${c.id}`);
				conversas.delete(c.id);
				if (ativa === c.id) {
					ativa = null;
					if (conversas.size) selecionar(conversas.keys().next().value);
					else { leitor?.seguir(undefined); ditado.desligar(true); }
				}

			} else if (dados.acao === 'anterior') { if (conversas.has(anterior)) selecionar(anterior); }
			else if (dados.acao === 'pendente') {
				const c = [...conversas.values()].filter(c => c.id !== ativa && (c.status === 'esperando' || c.novo)).sort((a, b) => (a.status !== 'esperando') - (b.status !== 'esperando') || a.desde - b.desde)[0]; if (c) selecionar(c.id);
			} else if (dados.acao === 'voz') await alternarVoz();
			else if (dados.acao === 'ditado') { if (!ativa) throw new Error('Abra uma conversa antes de ditar.'); ditado.alternar(); }
			else if (dados.acao === 'calar') leitor?.calar();
			else if (dados.acao === 'aviso') { aviso = ''; }
			else throw new Error('Ação desconhecida.');
			return json(res, 200, {ok: true});
		}
		const arquivo = arquivos.get(url.pathname);
		if (!arquivo || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
		res.writeHead(200, {'Content-Type': `${arquivo[1]}; charset=utf-8`, 'Cache-Control': 'no-cache'});
		res.end(await readFile(join(root, arquivo[0])));
	} catch (erro) { if (!res.headersSent) json(res, 400, {erro: erro.message || 'Não foi possível completar a ação.'}); else res.end(); }
});

const ws = new WebSocketServer({noServer: true, maxPayload: 128 * 1024});
servidor.on('upgrade', (req, conexao, head) => {
	const url = new URL(req.url, origem);
	if (req.headers.host !== new URL(origem).host || req.headers.origin !== origem || url.pathname !== '/terminal' || url.searchParams.get('key') !== chave || !conversas.has(url.searchParams.get('id'))) { conexao.destroy(); return; }
	ws.handleUpgrade(req, conexao, head, cliente => ws.emit('connection', cliente, url.searchParams.get('id')));
});
ws.on('connection', (cliente, id) => {
	let terminal;
	try {
		const ambiente = {...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor'};
		delete ambiente.TMUX;
		terminal = pty.spawn('tmux', ['-L', socket, 'attach-session', '-t', id], {name: 'xterm-256color', cols: 110, rows: 32, env: ambiente, cwd: pastaInicial});
	} catch { cliente.close(1011, 'Não foi possível abrir o terminal.'); return; }
	const saida = terminal.onData(dados => {
		if (cliente.readyState !== 1) return;
		if (cliente.bufferedAmount > 4 * 1024 * 1024) { cliente.close(1013, 'Reconectando terminal.'); return; }
		cliente.send(dados);
	});
	terminal.onExit(() => { cliente.close(); atualizar(); });
	cliente.on('message', dados => {
		try {
			const mensagem = JSON.parse(dados.toString());
			if (mensagem.tipo === 'entrada' && typeof mensagem.dados === 'string') {
				if (interrompeLeitura(mensagem.dados)) leitor?.calar();
				terminal.write(mensagem.dados);
			} else if (mensagem.tipo === 'tamanho' && Number.isInteger(mensagem.colunas) && Number.isInteger(mensagem.linhas)) {
				terminal.resize(Math.max(20, Math.min(400, mensagem.colunas)), Math.max(5, Math.min(200, mensagem.linhas)));
			}
		} catch {}
	});
	cliente.on('error', () => {});
	cliente.on('close', () => { saida.dispose(); try { terminal.kill(); } catch {} });
});

const intervalo = setInterval(atualizar, 650);
const intervaloPlano = setInterval(usoCodex, 5 * 60 * 1000);
process.on('SIGUSR2', atualizar);
function encerrar() {
	if (finalizando) return;
	finalizando = true; clearInterval(intervalo); clearInterval(intervaloPlano);
	leituraPlano.abort(); ditado.desligar(true); leitor?.calar();
	for (const cliente of ws.clients) cliente.terminate();
	try { tmux('kill-server'); } catch {}
	servidor.close();
}
process.on('SIGINT', encerrar); process.on('SIGTERM', encerrar);
process.on('exit', () => {
	if (pastaImagens) rmSync(pastaImagens, {recursive: true, force: true});
	if (!finalizando) { try { tmux('kill-server'); } catch {} }
});
servidor.listen(Number(process.env.HIVE_GUI_PORT) || 0, '127.0.0.1', () => {
	origem = `http://127.0.0.1:${servidor.address().port}`;
	const link = `${origem}/#${chave}`;
	console.log(`\n  Hive · interface gráfica local\n\n  ${link}\n\n  Ctrl-C encerra a interface e suas conversas.\n`);
	if (process.platform === 'darwin') { const cafe = spawn('caffeinate', ['-di', '-w', String(process.pid)], {stdio: 'ignore'}); cafe.on('error', () => {}); cafe.unref(); }
	if (!process.env.HIVE_GUI_NO_OPEN) {
		const abrir = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [link], {stdio: 'ignore'});
		abrir.on('error', () => console.log('Abra o link acima no navegador.'));
	}
	identificar(); usoCodex();
});
