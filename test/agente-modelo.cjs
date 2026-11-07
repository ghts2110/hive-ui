// TUI local para testar o protocolo de editor sem chamar APIs de modelos.
const {mkdtempSync, writeFileSync, readFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {execFileSync} = require('node:child_process');
const agente = process.env.HIVE_IA || 'claude';
let entrada = '';
let confirmado = '';
let modelo = agente === 'claude' ? 'Opus 5.5' : 'gpt-6.1-sol';
function render() {
	process.stdout.write('\x1b[2J\x1b[HAGENTE DE TESTE · ' + process.argv.slice(2).join(' ') + '\r\n');
	if (agente === 'claude') process.stdout.write(` ${modelo} · Claude Pro\r\n`);
	if (confirmado) process.stdout.write(confirmado + '\r\n');
	process.stdout.write(`${agente === 'claude' ? '❯' : '›'} ${entrada.replaceAll('\n', '\r\n')}\r\n────────────────\r\n`);
	if (agente === 'codex') process.stdout.write(`  ${modelo.toUpperCase()} low · ~/projeto\r\n`);
}
if (process.stdin.isTTY) process.stdin.setRawMode(true);
render();
process.stdin.on('data', dados => {
	for (const letra of dados.toString()) {
		if (letra === '\x04') process.exit();
		if (letra === '\x07') {
			const pasta = mkdtempSync(join(tmpdir(), 'hive-fake-editor-'));
			const arquivo = join(pasta, 'prompt');
			writeFileSync(arquivo, entrada);
			execFileSync(process.env.EDITOR, [arquivo], {stdio: 'inherit'});
			entrada = readFileSync(arquivo, 'utf8');
			rmSync(pasta, {recursive: true, force: true});
		} else if (letra === '\r') {
			if (entrada.startsWith('/model ')) {
				const id = entrada.slice(7);
				if (id === 'indisponivel') confirmado = `Model '${id}' is unavailable`;
				else {
					modelo = agente === 'claude' ? `${id[0].toUpperCase()}${id.slice(1)} 5.5` : id;
					confirmado = agente === 'claude' ? `Set model to ${modelo} and saved as your default for new sessions` : `Model changed to ${modelo} low for this session only`;
				}
			}
			entrada = '';
		} else entrada += letra;
	}
	render();
});
