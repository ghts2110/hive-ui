// Uso do plano do Codex: ele não tem statusline, mas o app-server dele
// responde, a qualquer hora, de que conta é o login (account/read) e quanto
// do plano já foi usado (account/rateLimits/read): a janela de 5h e a
// semanal, cada uma com a % e quando reinicia. Uma conversa
// JSON-RPC, uma mensagem por linha, com um codex app-server só para isso.
// Sem login, nada; logado por API, sem uso do plano.
import {spawn} from 'node:child_process';

// Cada janela pela duração (300 minutos, a de 5h; 10080, a semanal), não pela
// posição: num plano com outros limites, a primary pode ser a semanal. Sem a
// de 5h, um marcador no lugar dela, para a semanal não ser lida como ela.
const janela = (limites, minutos) => {
	const valor = [limites.primary, limites.secondary].find(j => j?.windowDurationMins === minutos);
	return Number.isFinite(valor?.usedPercent) && Number.isFinite(valor?.resetsAt)
		? `${valor.usedPercent} ${valor.resetsAt}`
		: '- -';
};

// Resolve com {conta, uso}: uso no mesmo formato do @uso do Claude
// (ver sidebar/uso.js e ler em sidebar/anel.js), "% reinício % reinício",
// a de 5h e a semanal. Sem o Codex, ou se ele não responder, resolve vazio.
// O sinal mata o app-server de uma leitura que não vale mais.
export function ler(codex, sinal, prazo = 15000) {
	return new Promise(resolve => {
		let servidor;
		try {
			servidor = spawn(codex, ['app-server'], {stdio: ['pipe', 'pipe', 'ignore'], signal: sinal});
		} catch {
			return resolve({});
		}
		const respostas = {};
		let resto = '';
		const fim = () => {
			clearTimeout(limite);
			servidor.kill();
			const conta = respostas[2]?.account?.type;
			const limites = respostas[3]?.rateLimits;
			const uso = limites ? `${janela(limites, 300)} ${janela(limites, 10080)}` : '';
			resolve(conta ? {conta, uso, plano: respostas[2]?.account?.planType} : {});
		};
		const limite = setTimeout(fim, prazo);
		servidor.on('error', fim);
		// close, não exit: só depois do stdout lido até o fim.
		servidor.on('close', fim);
		servidor.stdin.on('error', () => {});
		servidor.stdout.on('data', dados => {
			const linhas = (resto + dados).split('\n');
			resto = linhas.pop();
			for (const linha of linhas) {
				try {
					const {id, result, error} = JSON.parse(linha);
					if (id) respostas[id] = result ?? {error};
				} catch {}
			}
			if (respostas[2] && respostas[3]) fim();
		});
		const enviar = mensagem => servidor.stdin.write(JSON.stringify(mensagem) + '\n');
		enviar({id: 1, method: 'initialize', params: {clientInfo: {name: 'hive-ui', title: null, version: '0'}, capabilities: null}});
		enviar({method: 'initialized'});
		enviar({id: 2, method: 'account/read', params: {refreshToken: false}});
		enviar({id: 3, method: 'account/rateLimits/read'});
	});
}
