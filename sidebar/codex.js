// Config do Codex numa conversa do hive-ui (ver bin/conversa): imprime, uma
// por linha, as opções `-c` que ligam os hooks de status (sidebar/status.js),
// como o sidebar/hooks.json faz no Claude Code. Nada vai para o
// ~/.codex: valem só para este codex.
// O Codex só roda hooks confiáveis, e a confiança fica gravada na config do
// usuário. Aqui ela vai junto, também por -c: para cada hook, o hash que o
// Codex calcula dele (sha256 do JSON com as chaves em ordem, ver
// codex-rs/hooks/src/engine/discovery.rs). Se uma versão nova do Codex
// mudar a conta, os hooks não rodam e a conversa só fica sem status, sem
// pedir nada a ninguém.
import {createHash} from 'node:crypto';

const status = estado => `"$HIVE_NODE" "$HIVE_ROOT/sidebar/status.js" ${estado}`;
// Evento, estado e, quando há, o matcher. O Interrupt (Esc, Ctrl-C) tem
// prazo de no máximo 3s; os outros, o mesmo.
const hooks = [
	['UserPromptSubmit', 'user_prompt_submit', 'trabalhando'],
	['PostToolUse', 'post_tool_use', 'trabalhando'],
	['PermissionRequest', 'permission_request', 'esperando'],
	['Stop', 'stop', 'pronto'],
	['Interrupt', 'interrupt', 'pronto'],
	['SessionStart', 'session_start', 'limpar', 'clear'],
];
const prazo = 3;

// Chaves em ordem, como o serde_json do Codex depois do sort_all_objects.
const ordenado = valor => Array.isArray(valor)
	? valor.map(ordenado)
	: valor && typeof valor === 'object'
	? Object.fromEntries(Object.keys(valor).sort().map(chave => [chave, ordenado(valor[chave])]))
	: valor;
const hash = (evento, matcher, comando) => {
	const handler = {type: 'command', command: comando, timeout: prazo, async: false};
	const identidade = {event_name: evento, ...(matcher && {matcher}), hooks: [handler]};
	return 'sha256:' + createHash('sha256').update(JSON.stringify(ordenado(identidade))).digest('hex');
};

// Hooks passados por -c vêm deste arquivo virtual (ver hook_key no Codex).
const origem = '/<session-flags>/config.toml';
const toml = JSON.stringify;
const confianca = [];
for (const [evento, chave, estado, matcher] of hooks) {
	const comando = status(estado);
	const grupo = `${matcher ? `matcher=${toml(matcher)}, ` : ''}hooks=[{type="command", command=${toml(comando)}, timeout=${prazo}}]`;
	console.log(`hooks.${evento}=[{${grupo}}]`);
	confianca.push(`${toml(`${origem}:${chave}:0:0`)}={trusted_hash=${toml(hash(chave, matcher, comando))}}`);
}
console.log(`hooks.state={${confianca.join(', ')}}`);
