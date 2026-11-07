// Regras compartilhadas pela GUI e pelo cabeçalho do terminal. A troca deve
// operar no pane existente; criar ou retomar uma conversa não é uma troca.
import {mkdtemp, writeFile, access, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pausa} from 'node:timers/promises';

const trocas = new Set();

export function validarModelo(modelo) {
	if (typeof modelo !== 'string' || (modelo && !/^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]{0,199}$/.test(modelo))) {
		throw new Error('ID de modelo inválido.');
	}
	return modelo;
}

export function validarDisponibilidade(status) {
	if (status === 'trabalhando') throw new Error('Aguarde a resposta terminar antes de trocar o modelo.');
	if (status === 'esperando') throw new Error('Responda à interação pendente antes de trocar o modelo.');
}

export function validarVersao(agente, versao) {
	const atual = versao.match(/\d+\.\d+\.\d+/)?.[0]?.split('.').map(Number);
	const minimo = agente === 'codex' ? [0, 167, 0] : [2, 1, 311];
	const comparacao = atual?.reduce((resultado, n, i) => resultado || Math.sign(n - minimo[i]), 0);
	if (!atual || comparacao < 0) throw new Error(`Troca de modelo requer ${agente === 'codex' ? 'Codex CLI 0.167.0' : 'Claude Code 2.1.311'} ou superior. Atualize o agente para usar este recurso.`);
}

export function mesmoModelo(atual, escolhido) {
	if (!atual || !escolhido) return false;
	const normalizar = valor => valor.toLowerCase().replace(/[^a-z0-9]/g, '');
	return normalizar(atual) === normalizar(escolhido)
		|| (['opus', 'sonnet', 'haiku'].includes(escolhido) && normalizar(atual).startsWith(escolhido));
}

export function confirmacaoModelo(tela, agente) {
	const padrao = agente === 'codex'
		? /Model changed to ([\w.:[\]/-]+)[^\n]*for this session only/g
		: /Set model to (.+?)(?: and saved|\n|$)/g;
	return [...tela.matchAll(padrao)].at(-1)?.[1]?.trim();
}

export function detectarModelo(tela, agente) {
	if (agente === 'claude') return [...tela.matchAll(/(?:^|\n)[^\n]*?\s((?:Opus|Sonnet|Haiku|Fable)[^\n·]*?)\s*·/g)].at(-1)?.[1]?.trim();
	return [...tela.matchAll(/^\s*[│┃]?\s*model:\s*([^\s│]+)/gmi)].at(-1)?.[1]
		|| [...tela.matchAll(/^\s+(GPT-[\w.-]+)\s+[^\n]*·/gm)].at(-1)?.[1]?.toLowerCase();
}

const existe = async arquivo => { try { await access(arquivo); return true; } catch { return false; } };
async function aguardar(verificar, mensagem) {
	const limite = Date.now() + 6000;
	do {
		const resultado = await verificar();
		if (resultado) return resultado;
		await pausa(80);
	} while (Date.now() < limite);
	throw new Error(mensagem);
}

// O editor nativo entrega e recebe o texto inteiro, inclusive pastes expandidos.
// Nunca recortamos a linha visível nem usamos o histórico para recuperar texto.
export async function trocarModelo({pane, agente, modelo, tmux}) {
	validarModelo(modelo);
	if (!['claude', 'codex'].includes(agente)) throw new Error('Agente não suportado.');
	if (trocas.has(pane)) throw new Error('Já existe uma troca de modelo nesta conversa.');
	const consultar = opcao => tmux('show', '-pqv', '-t', pane, opcao);
	// O tmux também bloqueia send-keys em panes sem entrada. A lista de
	// comandos libera somente o envio interno e volta a bloquear no mesmo ciclo.
	const enviar = tecla => tmux('select-pane', '-e', '-t', pane, ';',
		'send-keys', '-t', pane, tecla, ';', 'select-pane', '-d', '-t', pane);
	const tela = () => tmux('capture-pane', '-p', '-t', pane, '-S', '-100');
	const antes = tela();
	const atual = consultar('@modelo') || detectarModelo(antes, agente);
	if (mesmoModelo(atual, modelo)) return atual;
	validarDisponibilidade(consultar('@status'));
	validarVersao(agente, consultar('@agente_versao'));
	if (consultar('@modelo_bridge') !== '1') throw new Error('Esta sessão não suporta a troca de modelo. Abra uma sessão com a versão atual do Hive.');
	if (!modelo && agente === 'codex') throw new Error('Informe o ID do modelo no Codex; o padrão não pode ser resolvido nesta sessão.');
	// Ctrl-G só pode ser enviado ao compositor, nunca a um diálogo de permissão.
	if (!(agente === 'claude' ? /❯[^\n]*\n[─━]/ : /›[^\n]*\n/).test(antes)) {
		throw new Error('Feche o menu ou a interação do agente antes de trocar o modelo.');
	}
	// select-pane também ativa o pane; devolve o foco a quem o tinha (ex.: o cabeçalho).
	const ativo = tmux('list-panes', '-t', pane, '-F', '#{pane_active} #{pane_id}').split('\n').find(l => l.startsWith('1 '))?.slice(2);
	trocas.add(pane);
	let pasta;
	try { pasta = await mkdtemp(join(tmpdir(), 'hive-modelo-')); }
	catch (erro) { trocas.delete(pane); throw erro; }
	let restaurado = false;
	let preparado = false;
	let erroOriginal;
	try {
		await writeFile(join(pasta, 'pedido.json'), JSON.stringify({modelo}), {mode: 0o600});
		tmux('set', '-p', '-t', pane, '@modelo_pedido', pasta);
		tmux('select-pane', '-d', '-t', pane);
		enviar('C-g');
		await aguardar(() => existe(join(pasta, 'preparado')), 'O agente não abriu o editor de rascunho. A troca não foi enviada.');
		preparado = true;
		const comando = `/model ${modelo || 'default'}`;
		await aguardar(() => tela().includes(comando), 'O agente não preparou o comando de modelo.');
		validarDisponibilidade(consultar('@status'));
		enviar('Enter');
		const confirmado = await aguardar(() => {
			const atual = tela();
			const valor = confirmacaoModelo(atual, agente);
			if (valor && valor !== confirmacaoModelo(antes, agente)) return valor;
			// Só vale erro novo: mensagens de tentativas anteriores continuam no scrollback.
			const erros = texto => texto.match(/Model '.+' is unavailable|Invalid model|Unknown model|not available|Unable to change model/gi)?.length ?? 0;
			if (erros(atual) > erros(antes)) {
				throw new Error('Modelo inválido ou indisponível. Confira a mensagem do agente no terminal.');
			}
		}, 'O agente não confirmou a troca. Confira o erro no terminal; nenhuma conversa foi criada.');
		tmux('set', '-p', '-t', pane, '@modelo', confirmado);
		return confirmado;
	} catch (erro) {
		erroOriginal = erro;
		throw erro;
	} finally {
		let falhaRestauracao;
		try {
			if (preparado || await existe(join(pasta, 'preparado'))) {
				enviar('C-g');
				await aguardar(() => existe(join(pasta, 'restaurado')), `Não foi possível restaurar o rascunho automaticamente. Ele está salvo em ${join(pasta, 'rascunho')}.`);
				restaurado = true;
			}
		} catch {
			falhaRestauracao = new Error(`Não foi possível restaurar o rascunho automaticamente. Ele está salvo em ${join(pasta, 'rascunho')}.`);
		} finally {
			try { tmux('set', '-pu', '-t', pane, '@modelo_pedido'); } catch {}
			try { tmux('select-pane', '-e', '-t', pane); } catch {}
			if (ativo && ativo !== pane) { try { tmux('select-pane', '-t', ativo); } catch {} }
			trocas.delete(pane);
			if (restaurado || !await existe(join(pasta, 'preparado'))) await rm(pasta, {recursive: true, force: true});
		}
		// Não esconde o motivo real da falha atrás do aviso de restauração.
		if (falhaRestauracao && !erroOriginal) throw falhaRestauracao;
	}
}
