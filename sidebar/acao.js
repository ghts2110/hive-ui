// Atalhos do tmux (ver bin/main-pane):
// `acao.js nova|fechar|ditar|proxima|anterior <sidebar>`.
import {abrir, fechar, naTela, nova, tmux, vizinha} from './conversas.js';

const [acao, sidebar] = process.argv.slice(2);
if (acao === 'nova') nova(sidebar);
else if (acao === 'proxima' || acao === 'anterior') {
	// Troca sem tirar o foco de onde estava: o rascunho fica no pane de cada conversa.
	const id = vizinha(sidebar, acao === 'proxima' ? 1 : -1);
	if (id) {
		const foco = tmux('display', '-p', '-t', sidebar, '#{pane_active}') === '1';
		abrir(sidebar, id);
		if (foco) tmux('select-pane', '-t', sidebar);
	}
} else if (acao === 'fechar') {
	fechar(sidebar, naTela(sidebar));
	tmux('select-pane', '-t', naTela(sidebar));
} else if (acao === 'ditar') {
	// O sidebar liga ou desliga o ditado quando o contador muda (ver
	// sidebar/index.js); o sinal o avisa sem esperar a próxima leitura.
	// Somado pelo próprio tmux: dois Ctrl-Q seguidos não se perdem.
	tmux('set', '-qF', '@ditar', '#{e|+:#{@ditar},1}');
	process.kill(Number(tmux('display', '-p', '-t', sidebar, '#{pane_pid}')), 'SIGUSR2');
}
