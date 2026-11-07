/* Interface gráfica; os agentes continuam executando nos próprios terminais. */
const paths = {
  terminal: '<path d="m5 5 6 7-6 7m9 0h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  folder: '<path d="M3 7V5h6l2 3h10v12H3Z"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  inbox: '<path d="m5 4-3 10v6h20v-6L19 4ZM2 14h6l2 3h4l2-3h6"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5M12 12 3 7m9 5v10M7.5 4.5l9 5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>', arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  volume: '<path d="M11 4 6 8H3v8h3l5 4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  claude: '<path d="m12 2 1 6 4-5-1 6 6-2-4 5 4 2-6 1 2 6-5-4-2 5-1-6-5 3 3-5-6-1 6-2-4-4 6 1Z"/>',
  codex: '<path d="m8 4-6 8 6 8m8-16 6 8-6 8m-3-14-2 12"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.terminal}</svg>`;
const $ = id => document.getElementById(id);
const hydrate = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
hydrate();
const chave = location.hash.slice(1) || sessionStorage.getItem('hive-key') || '';
sessionStorage.setItem('hive-key', chave);
history.replaceState(null, '', location.pathname);
const headers = {Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json'};
let state = null;
let selectedAgent = 'claude';
let closingId = null;
let terminal = null;
let fit = null;
let connection = null;
let terminalId = null;
let reconnectTimer;
let toastTimer;
let modelSource = null;
let connected = false;
let creating = false;
let notifications = false;
let observedStatuses = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function glyph(name, className = '') { const node = el('span', className); node.innerHTML = icon(name); return node; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500); }
async function api(path, data) {
  const response = await fetch(`/api/${path}`, {method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.erro || 'Não foi possível completar a ação.');
  return result;
}
const action = (acao, extra = {}) => api('action', {acao, ...extra}).catch(error => toast(error.message));
const current = () => state?.conversas.find(c => c.id === state.ativa);
const agentInfo = id => state?.agentes.find(a => a.id === id);
const folderName = path => path?.split('/').filter(Boolean).at(-1) || '/';
const statusNames = {trabalhando: 'Trabalhando', esperando: 'Aguardando você', pronto: 'Pronto'};
function duration(since) { if (!since) return ''; const sec = Math.max(0, Date.now() / 1000 - since); return sec < 3600 ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : sec < 86400 ? `${Math.floor(sec / 3600)}h` : `${Math.floor(sec / 86400)}d`; }

function renderList() {
  if (!state) return;
  const query = $('search').value.toLocaleLowerCase('pt-BR');
  const list = $('conversation-list'); list.replaceChildren();
  const items = state.conversas.filter(c => `${c.titulo} ${agentInfo(c.agente)?.nome} ${c.pasta}`.toLocaleLowerCase('pt-BR').includes(query));
  list.append(el('div', 'list-label', query ? 'RESULTADOS' : 'NESTA SESSÃO'));
  if (!items.length) list.append(el('p', 'empty-list', query ? 'Nenhuma conversa encontrada.' : 'Seu próximo projeto começa com uma conversa. Use o + acima para começar.'));
  for (const c of items) {
    const button = el('button', `conversation-card${c.id === state.ativa ? ' active' : ''}`);
    button.dataset.id = c.id; button.setAttribute('aria-current', c.id === state.ativa ? 'true' : 'false');
    button.title = `${c.titulo} · ${agentInfo(c.agente)?.nome} · ${c.pasta}`;
    const info = el('div'); info.append(el('div', 'conversation-title', c.titulo));
    const meta = el('div', 'conversation-meta');
    const dot = el('span', `small-status ${c.status}`); dot.title = statusNames[c.status] || 'Conversa aberta';
    meta.append(dot, el('span', 'folder-name', folderName(c.pasta)));
    if (c.linhas?.some(Number)) { const changes = el('span', 'changes', `+${c.linhas[0]} `); changes.append(el('span', 'removed', `−${c.linhas[1]}`)); meta.append(changes); }
    else meta.append(el('time', '', duration(c.desde)));
    info.append(meta); button.append(glyph(c.agente, `conversation-avatar ${c.agente}`), info);
    if (c.novo && c.id !== state.ativa) button.append(el('span', 'unread'));
    button.addEventListener('click', () => action('selecionar', {id: c.id})); list.append(button);
  }
  $('conversation-count').textContent = state.conversas.length;
  $('pending-count').textContent = state.conversas.filter(c => c.status === 'esperando' || (c.novo && c.id !== state.ativa)).length;
}
function renderUsage() {
  $('usage').replaceChildren();
  for (const a of state.agentes.filter(a => a.instalado)) {
    const row = el('div', `usage-row ${a.id}`); const title = el('div', 'usage-title');
    const parts = (a.uso || '').split(' ').map(Number); const known = a.uso && Number.isFinite(parts[0]) && Number.isFinite(parts[1]);
    title.append(glyph(a.id), el('strong', '', a.nome), el('span', '', known ? `${Math.round(parts[0])}% / 5h` : 'Uso indisponível'));
    const track = el('div', 'usage-track'); const fill = el('div', 'usage-fill'); fill.style.width = known ? `${Math.max(0, Math.min(100, parts[0]))}%` : '0%'; track.append(fill);
    if (known) row.title = `Reinicia às ${new Date(parts[1] * 1000).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}${Number.isFinite(parts[2]) && parts.length >= 4 ? ` · Semanal: ${Math.round(parts[2])}%` : ''}`;
    row.append(title, track); $('usage').append(row);
  }
}
function render() {
  const c = current(); const a = c && agentInfo(c.agente);
  $('workspace-name').textContent = folderName(c?.pasta || state.pasta);
  $('workspace-name').title = c?.pasta || state.pasta;
  $('breadcrumb-folder').textContent = folderName(c?.pasta || state.pasta);
  $('breadcrumb-title').textContent = c?.titulo || 'Visão geral';
  $('welcome').hidden = Boolean(c); $('agent-header').hidden = !c; $('terminal-section').hidden = !c;
  $('voice-button').setAttribute('aria-pressed', String(state.voz.ligada));
  $('voice-button').disabled = state.voz.preparando;
  $('mic-button').setAttribute('aria-pressed', String(state.microfone.fase !== 'desligado'));
  $('mic-button').disabled = !c;
  $('session-label').textContent = state.microfone.fase === 'baixando' ? `Baixando ditado${state.microfone.progresso == null ? '…' : ` · ${Math.floor(state.microfone.progresso * 100)}%`}` : state.microfone.fase === 'ouvindo' ? 'Ouvindo · o texto será digitado sem enviar' : state.microfone.fase === 'carregando' ? 'Preparando ditado…' : state.voz.falando ? 'Lendo resposta em voz alta' : c ? `${state.conversas.length} conversa${state.conversas.length > 1 ? 's' : ''} · execução local` : 'Pronto para começar';
  $('notice').hidden = !state.aviso; $('notice-text').textContent = state.aviso;
  if (c) {
    $('agent-name').textContent = a.nome; $('agent-version').textContent = a.versao ? `v${a.versao}` : '';
    $('agent-version').title = 'Versão do aplicativo';
    $('agent-status').textContent = statusNames[c.status] || 'Conversa aberta'; $('agent-status').className = `status-badge ${c.status}`;
    $('agent-avatar').className = `agent-avatar ${c.agente}`; $('agent-avatar').innerHTML = icon(c.agente);
    $('agent-plan').textContent = a.plano; $('agent-plan').hidden = !a.plano;
    $('agent-path').textContent = c.pasta; $('agent-path').title = c.pasta;
    $('model-name').textContent = c.modelo || 'Identificando…';
    $('terminal-label').textContent = c.status === 'trabalhando' ? 'Agente trabalhando' : c.status === 'esperando' ? 'O agente precisa de você' : 'Conversa ao vivo';
  }
  renderList(); renderUsage();
  if ((c?.id || null) !== terminalId) connectTerminal(c?.id || null);
  for (const conversation of state.conversas) {
    const old = observedStatuses.get(conversation.id);
    if (notifications && document.hidden && old === 'trabalhando' && ['pronto', 'esperando'].includes(conversation.status)) {
      const notification = new Notification(`${agentInfo(conversation.agente).nome} · ${statusNames[conversation.status]}`, {body: conversation.titulo, tag: conversation.id});
      notification.onclick = () => { window.focus(); action('selecionar', {id: conversation.id}); notification.close(); };
    }
  }
  observedStatuses = new Map(state.conversas.map(c => [c.id, c.status]));
}
function connectivity(value) { connected = value; document.body.classList.toggle('disconnected', !value); $('connection-label').textContent = value ? 'Conectado localmente' : 'Reconectando…'; }
async function followState() {
  let previous = '';
  while (true) {
    try {
      const next = await api('state');
      const serialized = JSON.stringify(next);
      connectivity(true);
      if (serialized !== previous) { state = next; render(); previous = serialized; }
    } catch (error) { connectivity(false); if (!state) toast(error.message); }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
}
function sizeTerminal() { if (!terminal || $('terminal-section').hidden) return; try { fit.fit(); if (connection?.readyState === WebSocket.OPEN) connection.send(JSON.stringify({tipo: 'tamanho', colunas: terminal.cols, linhas: terminal.rows})); } catch {} }
function connectTerminal(id) {
  clearTimeout(reconnectTimer);
  if (connection) { connection.onclose = null; connection.close(); connection = null; }
  terminalId = id;
  if (!id) { terminal?.dispose(); terminal = null; $('terminal').replaceChildren(); return; }
  if (!terminal) {
    terminal = new Terminal({cursorBlink: true, fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace', fontSize: 12, lineHeight: 1.3, scrollback: 10000, allowProposedApi: false, theme: {background: '#0b1117', foreground: '#ccd8df', cursor: '#35d8df', selectionBackground: '#25616d88', black: '#18232d', red: '#e78e98', green: '#76c9a3', yellow: '#e3c085', blue: '#8caef0', magenta: '#bd9bdc', cyan: '#6bcdd2', white: '#d0dce3', brightBlack: '#6b8394', brightRed: '#ffb1bb', brightGreen: '#a3e2bd', brightYellow: '#f6dba7', brightBlue: '#b2cbff', brightMagenta: '#d7b9f0', brightCyan: '#9de4e7', brightWhite: '#f0f5f8'}});
    fit = new FitAddon.FitAddon(); terminal.loadAddon(fit); terminal.open($('terminal'));
    terminal.onData(dados => { if (connection?.readyState === WebSocket.OPEN) connection.send(JSON.stringify({tipo: 'entrada', dados})); });
    terminal.onBell(() => { if (document.hidden) document.title = '● Hive · agente precisa de você'; });
    terminal.attachCustomKeyEventHandler(event => !handleShortcut(event));
  } else terminal.reset();
  $('terminal-reconnect').hidden = true;
  connection = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/terminal?id=${encodeURIComponent(id)}&key=${encodeURIComponent(chave)}`);
  connection.onopen = () => { sizeTerminal(); if (!document.querySelector('dialog[open]')) terminal.focus(); };
  connection.onmessage = event => terminal?.write(event.data);
  connection.onclose = () => { if (terminalId !== id) return; $('terminal-reconnect').hidden = false; reconnectTimer = setTimeout(() => { if (state?.conversas.some(c => c.id === id)) connectTerminal(id); }, 1400); };
  requestAnimationFrame(sizeTerminal);
}
new ResizeObserver(() => requestAnimationFrame(sizeTerminal)).observe($('terminal'));
window.addEventListener('focus', () => { document.title = 'Hive · seu espaço de trabalho'; });

function modelChoices(id) {
  const options = [{id: '', name: 'Padrão do agente', description: 'Usa a configuração atual do seu agente.'}];
  if (id === 'claude') options.push({id: 'opus', name: 'Opus', description: 'Alias do Claude · versão definida pelo agente.'}, {id: 'sonnet', name: 'Sonnet', description: 'Alias do Claude · versão definida pelo agente.'}, {id: 'haiku', name: 'Haiku', description: 'Alias do Claude · versão definida pelo agente.'});
  else if (current()?.agente === id && current().modelo) options.push({id: current().modelo, name: current().modelo, description: 'Modelo identificado na conversa atual.'});
  return options;
}
function createOptions() {
  const select = $('create-model'); select.replaceChildren();
  for (const option of modelChoices(selectedAgent)) { const node = el('option', '', option.name); node.value = option.id; select.append(node); }
  const other = el('option', '', 'Outro modelo…'); other.value = '__custom__'; select.append(other);
  $('create-custom-model').hidden = true; $('create-custom-model').value = '';
}
function openCreate() {
  if (!state || !connected) return toast('Aguarde a conexão com o servidor local.');
  $('create-error').textContent = ''; $('create-folder').value = current()?.pasta || state.pasta;
  selectedAgent = current()?.agente || state.agentes.find(a => a.instalado)?.id || 'claude';
  $('agent-choices').replaceChildren();
  for (const a of state.agentes) {
    const label = el('label', `agent-choice ${a.id}${a.instalado ? '' : ' unavailable'}`);
    const radio = el('input'); radio.type = 'radio'; radio.name = 'agent'; radio.value = a.id; radio.checked = selectedAgent === a.id;
    const name = el('span'); name.append(el('strong', '', a.nome), el('small', '', a.instalado ? 'Disponível neste computador' : 'Instale para continuar'));
    label.append(radio, glyph(a.id, 'agent-choice-icon'), name, glyph('check', 'choice-check'));
    radio.addEventListener('change', () => { selectedAgent = a.id; createOptions(); $('create-error').textContent = a.instalado ? '' : `${a.nome} não encontrado. Instale e faça login pelo terminal.`; });
    $('agent-choices').append(label);
  }
  createOptions(); $('create-dialog').showModal();
}
function openModel() {
  const c = current(); if (!c) return;
  modelSource = {...c}; $('model-options').replaceChildren(); $('custom-model').value = ''; $('model-error').textContent = '';
  for (const option of modelChoices(c.agente).filter(option => c.agente !== 'codex' || option.id)) {
    const label = el('label', 'model-option'); const radio = el('input'); radio.type = 'radio'; radio.name = 'model'; radio.value = option.id; radio.checked = option.id === c.modelo || (c.agente === 'claude' && option.id && c.modelo?.toLowerCase().startsWith(option.id)) || (!c.modelo && option.id === '');
    radio.addEventListener('change', () => { $('custom-model').value = ''; });
    const text = el('span'); text.append(el('strong', '', option.name), el('small', '', option.description)); label.append(radio, text); $('model-options').append(label);
  }
  $('model-dialog').showModal();
}
async function createConversation(values, errorId, buttonId, dialogId) {
  if (creating) return;
  creating = true; $(buttonId).disabled = true; $(errorId).textContent = '';
  try { await api('conversations', values); $(dialogId).close(); }
  catch (error) { $(errorId).textContent = error.message; }
  finally { creating = false; $(buttonId).disabled = false; }
}
$('create-form').addEventListener('submit', event => {
  event.preventDefault(); createConversation({agente: selectedAgent, modelo: $('create-model').value === '__custom__' ? $('create-custom-model').value.trim() : $('create-model').value, pasta: $('create-folder').value.trim()}, 'create-error', 'create-submit', 'create-dialog');
});
$('create-model').addEventListener('change', () => { $('create-custom-model').hidden = $('create-model').value !== '__custom__'; if (!$('create-custom-model').hidden) $('create-custom-model').focus(); });
$('model-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!modelSource) return;
  if ($('model-submit').disabled) return;
  $('model-submit').disabled = true; $('model-error').textContent = '';
  try {
    await api('action', {acao: 'modelo', id: modelSource.id, modelo: $('custom-model').value.trim() || document.querySelector('input[name=model]:checked')?.value || ''});
    $('model-dialog').close();
  } catch (error) { $('model-error').textContent = error.message; }
  finally { $('model-submit').disabled = false; }
});
$('custom-model').addEventListener('input', () => { if ($('custom-model').value) document.querySelectorAll('input[name=model]').forEach(radio => { radio.checked = false; }); });
$('new-conversation').onclick = openCreate; $('welcome-create').onclick = openCreate;
$('search').addEventListener('input', renderList); $('model-button').onclick = openModel;
$('help').onclick = () => $('help-dialog').showModal();
$('pending').onclick = () => action('pendente');
$('toggle-sidebar').onclick = () => { document.body.classList.toggle('sidebar-hidden'); requestAnimationFrame(sizeTerminal); };
$('terminal-focus').onclick = () => terminal?.focus();
$('voice-button').onclick = () => action('voz'); $('mic-button').onclick = () => action('ditado');
$('dismiss-notice').onclick = () => action('aviso');
$('close-conversation').onclick = () => { if (!current()) return; closingId = current().id; $('close-dialog').showModal(); };
$('confirm-close').onclick = async () => { if (!closingId) return; await action('fechar', {id: closingId}); $('close-dialog').close(); };
document.querySelectorAll('[data-dismiss]').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); });
  dialog.addEventListener('close', () => terminal?.focus());
});
function handleShortcut(event) {
  if (event.type !== 'keydown' || event.repeat || document.querySelector('dialog[open]')) return false;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.body.classList.remove('sidebar-hidden'); $('search').focus(); return true; }
  if (event.ctrlKey && event.key.toLowerCase() === 't') { event.preventDefault(); openCreate(); return true; }
  if (event.ctrlKey && event.key.toLowerCase() === 'q') { event.preventDefault(); action('ditado'); return true; }
  if (event.ctrlKey && event.key === ']') { event.preventDefault(); openModel(); return true; }
  if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); action('anterior'); return true; }
  if (event.altKey && event.key.toLowerCase() === 'p') { event.preventDefault(); action('pendente'); return true; }
  if (event.key === 'Escape') action('calar');
  return false;
}
document.addEventListener('keydown', event => { if (!event.target.closest('.xterm')) handleShortcut(event); });
// A permissão de notificações só é solicitada por uma ação explícita.
const notifyButton = el('button', 'icon-button'); notifyButton.setAttribute('aria-label', 'Ativar notificações'); notifyButton.title = 'Ativar notificações quando outra janela estiver em foco'; notifyButton.innerHTML = icon('inbox');
if ('Notification' in window) { $('connection-label').after(notifyButton); notifyButton.onclick = async () => { notifications = await Notification.requestPermission() === 'granted'; toast(notifications ? 'Notificações ativadas nesta sessão.' : 'Notificações não foram ativadas.'); }; }
followState();
setInterval(() => { if (state && !document.querySelector('dialog[open]')) renderList(); }, 30000);
