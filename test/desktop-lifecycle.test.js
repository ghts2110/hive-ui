import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const vivo = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function esperar(condicao) {
 const limite = Date.now() + 10000;
 while (!await condicao()) { if (Date.now() > limite) throw Error('Prazo excedido'); await new Promise(r => setTimeout(r, 30)); }
}
for (const falha of [false, true]) test(falha ? 'falha da janela é informada e limpa o serviço' : 'launcher sai após abertura e supervisor mantém os filhos até fechar a janela', async () => {
 const pasta = await mkdtemp(join(tmpdir(), 'hive-ciclo-'));
 let pids;
 try {
  await mkdir(join(pasta, 'node_modules/electron'), {recursive: true});
  await writeFile(join(pasta, 'package.json'), '{"type":"module"}');
  await writeFile(join(pasta, 'node_modules/electron/index.js'), `module.exports = ${JSON.stringify(process.execPath)};`);
  await copyFile(new URL('../gui/desktop.js', import.meta.url), join(pasta, 'desktop.js'));
  await writeFile(join(pasta, 'server.js'), `import {writeFileSync} from 'node:fs'; writeFileSync('supervisor.pid', String(process.ppid)); writeFileSync('servidor.pid', String(process.pid)); console.log('http://127.0.0.1:12345/#'+'a'.repeat(64)); setInterval(()=>{},1000);`);
  await writeFile(join(pasta, 'window.cjs'), `require('node:fs').writeFileSync('janela.pid', String(process.pid)); ${falha ? "console.error('falha simulada'); process.exit(1);" : "setTimeout(()=>console.log('HIVE_WINDOW_READY'),150); setInterval(()=>{},1000);"}`);
  const launcher = spawn(process.execPath, [join(pasta, 'desktop.js')], {cwd: pasta, stdio: ['ignore','pipe','pipe']});
  let saida = ''; let erros = '';
  launcher.stdout.on('data', d => saida += d); launcher.stderr.on('data', d => erros += d);
  const [codigo] = await once(launcher, 'exit');
  pids = await Promise.all(['servidor.pid','janela.pid','supervisor.pid'].map(async nome => Number(await readFile(join(pasta,nome),'utf8'))));
  if (falha) { assert.equal(codigo, 1); assert.match(erros, /falha simulada/); }
  else {
   assert.equal(codigo, 0); assert.match(saida, /Hive aberto/);
   assert.ok(pids.every(vivo), 'filhos continuam vivos depois da saída do launcher');
   process.kill(pids[1], 'SIGTERM');
  }
  await esperar(() => pids.every(pid => !vivo(pid)));
 } finally {
  for (const pid of pids || []) if (vivo(pid)) process.kill(pid, 'SIGTERM');
  await rm(pasta, {recursive: true, force: true});
 }
});
