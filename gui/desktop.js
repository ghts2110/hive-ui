// O backend continua no Node do usuário: os módulos nativos do terminal e
// da voz não precisam ser recompilados para o runtime da janela.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const pasta = dirname(fileURLToPath(import.meta.url));
let executavel;
try { executavel = createRequire(import.meta.url)('electron'); }
catch { console.error('hive: dependências do aplicativo ausentes. Rode npm install no repositório.'); process.exit(1); }
const ambiente = {...process.env};
delete ambiente.ELECTRON_RUN_AS_NODE;
const servidor = spawn(process.execPath, [join(pasta, 'server.js')], {
	cwd: process.cwd(), env: {...ambiente, HIVE_GUI_NO_OPEN: '1'}, stdio: ['ignore', 'pipe', 'pipe'],
});
let janela;
let encerrando = false;
let saida = '';
let erros = '';
let prazoFinal;
const prazoInicio = setTimeout(() => falhou('O serviço local não iniciou a tempo.'), 20000);

function encerrar(codigo = 0) {
	if (encerrando) return;
	encerrando = true; process.exitCode = codigo;
	clearTimeout(prazoInicio);
	janela?.kill('SIGTERM');
	servidor.kill('SIGTERM');
	// Um processo em erro não pode deixar os agentes e o bloqueio de repouso vivos.
	prazoFinal = setTimeout(() => { janela?.kill('SIGKILL'); servidor.kill('SIGKILL'); }, 5000);
	prazoFinal.unref();
}
function falhou(mensagem) { console.error(`hive: ${mensagem}`); encerrar(1); }
servidor.stderr.on('data', dados => { erros = (erros + dados).slice(-8000); });
servidor.on('error', erro => falhou(erro.message));
servidor.on('exit', codigo => {
	if (!encerrando) falhou(erros.trim() || `O serviço local encerrou (${codigo ?? 'sinal'}).`);
	if (!janela || janela.exitCode !== null || janela.signalCode) clearTimeout(prazoFinal);
});
servidor.stdout.on('data', dados => {
	saida += dados;
	const link = saida.match(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/)?.[0];
	if (!link || janela || encerrando) return;
	clearTimeout(prazoInicio);
	janela = spawn(executavel, [join(pasta, 'window.cjs'), link], {env: ambiente, stdio: ['ignore', 'ignore', 'pipe']});
	let errosJanela = '';
	janela.stderr.on('data', dados => { errosJanela = (errosJanela + dados).slice(-4000); });
	janela.on('error', erro => falhou(`Não foi possível abrir a janela: ${erro.message}`));
	janela.on('exit', codigo => {
		if (codigo && !encerrando) console.error(`hive: a janela encerrou com erro. ${errosJanela.trim()}`);
		encerrar(codigo ? 1 : 0);
	});
	console.log('Hive aberto. Fechar a janela encerra suas conversas.');
});
process.on('SIGINT', () => encerrar());
process.on('SIGTERM', () => encerrar());
process.on('exit', () => { servidor.kill('SIGTERM'); janela?.kill('SIGTERM'); });
