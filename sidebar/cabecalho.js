// Cabeçalho da conversa na tela. O botão de modelo altera a sessão ativa;
// o seletor de agentes fica no + da sidebar.
import React, {useEffect, useState} from 'react';
import {render, Box, Text, useInput, useStdout} from 'ink';
import {execFileSync} from 'node:child_process';
import {naTela, tmux, caminhoCodex} from './conversas.js';
import {trocarModelo, detectarModelo} from './modelo.js';

const h = React.createElement;
const apagado = '#6b7280';
const destaque = '#0891b2';
const agentes = {claude: {nome: 'Claude Code', simbolo: '✳', cor: '#d97706'}, codex: {nome: 'Codex', simbolo: '›_', cor: '#3b82f6'}};
const planos = {pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise'};
const provedores = {bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry'};
const versoes = new Map();
let planoClaude;
try {
	const dados = JSON.parse(execFileSync(process.env.HIVE_CLAUDE, ['auth', 'status'], {encoding: 'utf8', stdio: 'pipe', timeout: 3000}));
	planoClaude = dados.apiProvider && dados.apiProvider !== 'firstParty' ? provedores[dados.apiProvider]
		: ['api_key', 'api_key_helper'].includes(dados.authMethod) ? 'API Usage Billing' : planos[dados.subscriptionType];
} catch {}

const cabecalho = process.env.TMUX_PANE;
const modelos = new Map();
function ler() {
	const sidebar = tmux('show', '-qv', '@sidebar');
	const id = naTela(sidebar);
	if (!id) return {};
	const [pasta, agente, escolhido] = tmux('display', '-p', '-t', id, '#{pane_current_path}\t#{@ia}\t#{@modelo}').split('\t');
	const ia = agente === 'codex' ? 'codex' : 'claude';
	if (!versoes.has(ia)) {
		versoes.set(ia, '');
		try {
			const binario = ia === 'codex' ? caminhoCodex() : process.env.HIVE_CLAUDE;
			versoes.set(ia, execFileSync(binario, ['--version'], {encoding: 'utf8', stdio: 'pipe', timeout: 3000}).match(/\d+\.\d+\.\d+\S*/)?.[0] ?? '');
		} catch {}
	}
	// Lê o modelo que a própria TUI informa, sem presumir qual é o padrão.
	// A statusline do Claude também o publica em @modelo, inclusive após /model.
	const tela = tmux('capture-pane', '-p', '-t', id, '-S', '-100');
	const modelo = detectarModelo(tela, ia);
	if (modelo) modelos.set(id, modelo);
	for (const pane of modelos.keys()) {
		// Limita o cache sem ler todos os panes a cada intervalo.
		if (modelos.size > 100 && pane !== id) modelos.delete(pane);
	}
	const [janela, zoom] = tmux('display', '-p', '-t', sidebar, '#{window_id} #{window_zoomed_flag}').split(' ');
	if (zoom !== '1' && tmux('display', '-p', '-t', cabecalho, '#{window_id}') !== janela) {
		tmux('join-pane', '-d', '-v', '-b', '-l', '3', '-s', cabecalho, '-t', id);
	}
	const home = process.env.HOME;
	return {id, sidebar, ia, modelo: ia === 'claude' ? escolhido || modelos.get(id) : modelos.get(id) || escolhido,
		plano: ia === 'claude' ? planoClaude : tmux('show', '-qv', '@plano_codex'),
		pasta: home && (pasta === home || pasta.startsWith(home + '/')) ? '~' + pasta.slice(home.length) : pasta,
		focado: tmux('display', '-p', '-t', cabecalho, '#{pane_active}') === '1'};
}

function Cabecalho() {
	const {stdout} = useStdout();
	const [estado, setEstado] = useState({});
	const [largura, setLargura] = useState(stdout.columns || 80);
	const [menu, setMenu] = useState(null);
	const [opcao, setOpcao] = useState(0);
	const [modelo, setModelo] = useState('');
	const [erro, setErro] = useState('');
	const [trocando, setTrocando] = useState(false);
	useEffect(() => {
		let anterior;
		const atualizar = () => {
			setLargura(stdout.columns || 80);
			try {
				const novo = ler();
				const chave = JSON.stringify(novo);
				if (chave !== anterior) { anterior = chave; setEstado(novo); }
			} catch {}
		};
		atualizar();
		process.on('SIGUSR2', atualizar);
		const intervalo = setInterval(atualizar, 500);
		stdout.on('resize', atualizar);
		stdout.write('\x1b[?1000h\x1b[?1006h\x1b[?25l');
		const sair = () => stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h');
		process.on('exit', sair);
		return () => {
			clearInterval(intervalo);
			process.off('SIGUSR2', atualizar);
			stdout.off('resize', atualizar);
			process.off('exit', sair);
			sair();
		};
	}, []);
	useEffect(() => { setMenu(null); setErro(''); }, [estado.id]);
	useEffect(() => { if (!estado.focado) { setMenu(null); setErro(''); } }, [estado.focado]);
	const voltar = () => {
		setMenu(null); setErro('');
		if (estado.id) tmux('select-pane', '-t', estado.id);
	};
	const opcoes = estado.ia === 'codex'
		? [...(estado.modelo ? [{nome: estado.modelo, id: estado.modelo}] : []), {nome: 'Outro ID…', id: null}]
		: [{nome: 'Padrão', id: ''}, {nome: 'Opus', id: 'opus'}, {nome: 'Sonnet', id: 'sonnet'}, {nome: 'Haiku', id: 'haiku'}, {nome: 'Outro ID…', id: null}];
	const escolher = () => { setOpcao(0); setModelo(''); setErro(''); setMenu('lista'); };
	const trocar = async escolhido => {
		if (trocando) return;
		setTrocando(true);
		try {
			await trocarModelo({pane: estado.id, agente: estado.ia, modelo: escolhido, tmux});
			setMenu(null); setErro('');
		} catch (erro) { setErro(erro.message || 'Não foi possível trocar o modelo.'); }
		finally { setTrocando(false); }
	};
	const selecionar = indice => {
		const item = opcoes[indice];
		if (!item) return;
		setOpcao(indice);
		if (item.id === null) { setMenu('modelo'); setModelo(''); }
		else trocar(item.id);
	};
	const botao = '[ Trocar modelo ▾ ]';
	const inicioBotao = Math.max(1, largura - botao.length);
	let colunaOpcao = 2;
	const regioes = opcoes.map((item, indice) => {
		const texto = ` ${item.nome} `;
		const inicio = colunaOpcao;
		colunaOpcao += texto.length + 1;
		return {inicio, fim: colunaOpcao - 1, texto, indice};
	});
	useInput((input, key) => {
		if (trocando) return;
		try {
			const eventos = [...input.matchAll(/\[<(\d+);(\d+);(\d+)([Mm])/g)];
			if (eventos.length) {
				for (const [, botaoMouse, coluna, linha, tipo] of eventos) {
					if (botaoMouse !== '0' || tipo !== 'M') continue;
					if (!menu && Number(linha) === 1 && Number(coluna) >= inicioBotao) escolher();
					else if (menu === 'lista' && Number(linha) === 2) {
						const regiao = regioes.find(r => Number(coluna) >= r.inicio && Number(coluna) < r.fim);
						if (regiao) selecionar(regiao.indice);
					}
				}
				return;
			}
			if (key.escape || (key.ctrl && input === 'c')) return voltar();
			if (menu === 'modelo') {
				if (key.return) return trocar(modelo.trim());
				if (key.backspace || key.delete) setModelo(m => m.slice(0, -1));
				else if (!key.ctrl && !key.meta) setModelo(m => (m + input.replace(/[^a-zA-Z0-9._:/\[\]-]/g, '')).slice(0, 200));
				return;
			}
			if (menu === 'lista') {
				if (key.leftArrow || key.upArrow) setOpcao(n => (n + opcoes.length - 1) % opcoes.length);
				else if (key.rightArrow || key.downArrow || key.tab) setOpcao(n => (n + 1) % opcoes.length);
				else if (key.return) selecionar(opcao);
				else if (input === 'i') { setModelo(''); setMenu('modelo'); }
			} else if (input === 'm' || key.return) escolher();
		} catch { setErro('Não foi possível acessar a conversa.'); }
	});
	const agente = agentes[estado.ia] ?? agentes.claude;
	const linha = (key, texto, props = {}) => h(Text, {key, wrap: 'truncate-end', ...props}, texto);
	let linhas;
	if (menu === 'lista') linhas = [
		linha(1, ` Trocar modelo · ${agente.nome}`, {color: destaque, bold: true}),
		h(Box, {key: 2, paddingLeft: 1, overflow: 'hidden'}, regioes.map(({texto, indice}) => h(Text, {
			key: indice, color: indice === opcao ? '#ffffff' : apagado,
			backgroundColor: indice === opcao ? destaque : undefined, bold: indice === opcao,
		}, texto + ' '))),
		linha(3, erro || (trocando ? ' Trocando modelo…' : ' ← → escolher · enter trocar · i informar ID · esc cancelar'), {color: erro ? '#dc2626' : apagado}),
	];
	else if (menu === 'modelo') linhas = [
		linha(1, ` Trocar modelo · ${agente.nome}`, {color: destaque, bold: true}),
		linha(2, ` ID: ${modelo}▏`, {color: destaque}),
		linha(3, erro || (trocando ? ' Trocando modelo…' : ' enter trocar · vazio usa padrão · esc cancelar'), {color: erro ? '#dc2626' : apagado}),
	];
	else linhas = [
		h(Box, {key: 1, justifyContent: 'space-between', paddingX: 1},
			h(Box, {flexShrink: 1, overflow: 'hidden'}, linha('agente', `${agente.simbolo} ${agente.nome}${versoes.get(estado.ia) ? ` v${versoes.get(estado.ia)}` : ''}`, {color: agente.cor, bold: true})),
			h(Text, {color: estado.focado ? '#ffffff' : destaque, backgroundColor: estado.focado ? destaque : undefined, bold: true}, botao)),
		linha(2, ` Modelo: ${estado.modelo || 'aguardando identificação…'}${estado.plano ? `   ·   ${estado.plano}` : ''}`, {bold: true}),
		linha(3, erro || ` ${estado.pasta || ''}${estado.focado ? '   ·   m modelo · esc voltar' : ''}`, {color: erro ? '#dc2626' : apagado}),
	];
	return h(Box, {flexDirection: 'column', height: 3, overflow: 'hidden'}, linhas);
}

render(h(Cabecalho), {exitOnCtrlC: false, patchConsole: false});
