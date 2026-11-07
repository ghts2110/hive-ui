// Ponte do editor externo: fora de uma troca, respeita o editor do usuário.
// Durante a troca, o agente entrega o rascunho completo em seu arquivo nativo.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmux} from './conversas.js';

let pedido;
try { pedido = tmux('show', '-pqv', '-t', process.env.TMUX_PANE, '@modelo_pedido'); } catch {}
if (!pedido) {
	const editor = process.env.HIVE_EDITOR_ORIGINAL || 'vi';
	const resultado = spawnSync('sh', ['-c', `${editor} "$@"`, 'hive-editor', ...process.argv.slice(2)], {stdio: 'inherit'});
	process.exit(resultado.status ?? 1);
}

const arquivo = process.argv.at(-1);
const configuracao = JSON.parse(readFileSync(join(pedido, 'pedido.json'), 'utf8'));
const pronto = join(pedido, 'preparado');
if (!existsSync(pronto)) {
	writeFileSync(join(pedido, 'rascunho'), readFileSync(arquivo), {mode: 0o600});
	writeFileSync(arquivo, `/model ${configuracao.modelo || 'default'}`);
	writeFileSync(pronto, '');
} else {
	writeFileSync(arquivo, readFileSync(join(pedido, 'rascunho')));
	writeFileSync(join(pedido, 'restaurado'), '');
}
