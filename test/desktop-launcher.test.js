import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
let pasta;
let env;
before(async () => {
	pasta = await mkdtemp(join(tmpdir(), 'hive-launcher-'));
	await writeFile(join(pasta, 'node'), '#!/bin/sh\nprintf "NODE\\n"; printf "%s\\n" "$@"\n', {mode: 0o755});
	await writeFile(join(pasta, 'claude'), '#!/bin/sh\nprintf "CLAUDE\\n"; printf "%s\\n" "$@"\n', {mode: 0o755});
	await symlink(join(root, 'bin/hive'), join(pasta, 'hive'));
	env = {...process.env, PATH: `${pasta}:${process.env.PATH}`, TMUX: '', HIVE: ''};
});
after(async () => { await rm(pasta, {recursive: true, force: true}); });
const abrir = (args, caminho = join(root, 'bin/hive')) => execFileSync(caminho, args, {env, encoding: 'utf8'});

test('hive sem argumentos abre o aplicativo próprio', () => {
	assert.equal(abrir([]), `NODE\n${root}/gui/desktop.js\n`);
});
test('--gui continua funcionando como alias do aplicativo', () => {
	assert.equal(abrir(['--gui']), abrir([]));
});
test('o comando instalado por link encontra o aplicativo', () => {
	assert.equal(abrir([], join(pasta, 'hive')), abrir([]));
});
test('--terminal é consumido e argumentos do agente continuam intactos', () => {
	assert.equal(abrir(['--terminal', '-p', 'uma mensagem;']), 'CLAUDE\n-p\numa mensagem;\n');
});
test('subcomandos e modo não interativo não abrem uma janela', () => {
	assert.equal(abrir(['auth', 'status']), 'CLAUDE\nauth\nstatus\n');
	assert.equal(abrir(['-p', 'olá']), 'CLAUDE\n-p\nolá\n');
});
test('--gui rejeita argumentos em vez de descartar silenciosamente', () => {
	const resultado = spawnSync(join(root, 'bin/hive'), ['--gui', 'ignorado'], {env, encoding: 'utf8'});
	assert.equal(resultado.status, 1);
	assert.match(resultado.stderr, /escolha o agente/);
});
