// onData do xterm também envia foco, mouse e respostas do terminal.
// O ESC que inicia essas sequências não é uma tecla Escape pressionada.
export function interrompeLeitura(dados) {
	return dados === '\x1b' || dados === '\x03';
}
