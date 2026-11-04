// Uso do plano do Codex: ele não tem statusline, mas o app-server dele
// responde, a qualquer hora, de que conta é o login (account/read) e quanto
// do plano já foi usado (account/rateLimits/read): a janela de 5h (primary) e
// a semanal (secondary), cada uma com a % e quando reinicia. Uma conversa
// JSON-RPC, uma mensagem por linha, com um codex app-server só para isso.
// Sem login, nada; logado por API, sem uso do plano.
import {spawn} from 'node:child_process';

const janela = valor => Number.isFinite(valor?.usedPercent) && Number.isFinite(valor?.resetsAt)
	? `${valor.usedPercent} ${valor.resetsAt}`
	: '';

// Resolve com {conta, uso}: uso no mesmo formato do @uso do Claude
// (ver sidebar/uso.js e ler em sidebar/anel.js), "% reinício % reinício",
// a de 5h e a semanal. Sem o Codex, ou se ele não responder, resolve vazio.
export function ler(codex, prazo = 15000) {
	return new Promise(resolve => {
		let servidor;
		try {
			servidor = spawn(codex, ['app-server'], {stdio: ['pipe', 'pipe', 'ignore']});
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
			const uso = limites ? `${janela(limites.primary)} ${janela(limites.secondary)}`.trim() : '';
			resolve(conta ? {conta, uso} : {});
		};
		const limite = setTimeout(fim, prazo);
		servidor.on('error', fim);
		servidor.on('exit', fim);
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
