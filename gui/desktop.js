// O backend continua no Node do usuário: os módulos nativos do terminal e
// da voz não precisam ser recompilados para o runtime da janela.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const pasta = dirname(fileURLToPath(import.meta.url));
// Só o supervisor pertence à sessão independente. O launcher aguarda a
// confirmação da janela pelo IPC e então devolve o prompt.
if (process.argv[2] !== '--supervisor') {
	const supervisor = spawn(process.execPath, [fileURLToPath(import.meta.url), '--supervisor'], {
		cwd: process.cwd(), env: process.env, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
	});
	let pronto = false;
	supervisor.on('message', mensagem => {
		if (mensagem.tipo === 'pronto') {
			pronto = true;
			console.log('Hive aberto. Fechar a janela encerra suas conversas.');
			supervisor.disconnect(); supervisor.unref();
		} else if (mensagem.tipo === 'erro') console.error(`hive: ${mensagem.mensagem}`);
	});
	supervisor.on('error', erro => { console.error(`hive: ${erro.message}`); process.exitCode = 1; });
	supervisor.on('exit', () => { if (!pronto) { console.error('hive: não foi possível abrir o aplicativo.'); process.exitCode = 1; } });
} else {
	process.channel?.unref();
	let executavel;
	try { executavel = createRequire(import.meta.url)('electron'); }
	catch { process.send?.({tipo: 'erro', mensagem: 'Dependências do aplicativo ausentes. Rode npm install no repositório.'}); process.exit(1); }
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
	let abriu = false;
	const prazoInicio = setTimeout(() => falhou('O aplicativo não abriu a tempo.'), 20000);

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
	function falhou(mensagem) { if (process.connected) process.send({tipo: 'erro', mensagem}); encerrar(1); }
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
		janela = spawn(executavel, [join(pasta, 'window.cjs'), link], {env: ambiente, stdio: ['ignore', 'pipe', 'pipe']});
		let confirmacao = '';
		janela.stdout.on('data', dados => {
			confirmacao = (confirmacao + dados).slice(-1000);
			if (!confirmacao.includes('HIVE_WINDOW_READY\n') || encerrando || abriu) return;
			clearTimeout(prazoInicio);
			abriu = true;
			if (process.connected) process.send({tipo: 'pronto'});
		});
		let errosJanela = '';
		janela.stderr.on('data', dados => { errosJanela = (errosJanela + dados).slice(-4000); });
		janela.on('error', erro => falhou(`Não foi possível abrir a janela: ${erro.message}`));
		janela.on('exit', codigo => {
			if (codigo && !encerrando) falhou(`A janela encerrou com erro. ${errosJanela.trim()}`);
			encerrar(codigo ? 1 : 0);
		});
	});
	process.on('disconnect', () => { if (!abriu) encerrar(1); });
	process.on('SIGINT', () => encerrar());
	process.on('SIGTERM', () => encerrar());
	process.on('exit', () => { servidor.kill('SIGTERM'); janela?.kill('SIGTERM'); });
}
