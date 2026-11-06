// Janela local: a interface não recebe acesso às APIs do Node ou do Electron.
const {app, BrowserWindow, Menu, nativeTheme} = require('electron');
const link = process.argv.find(arg => /^http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})$/.test(arg));
if (!link) { console.error('hive: endereço local do aplicativo ausente.'); app.exit(1); }
const origem = link && new URL(link).origin;
let janela;
app.setName('Hive');
nativeTheme.themeSource = 'dark';
// Sessão em memória, sem reaproveitar dados de outras execuções do aplicativo.
app.whenReady().then(() => {
	Menu.setApplicationMenu(Menu.buildFromTemplate([
		{label: 'Hive', submenu: [{label: 'Sobre o Hive', role: 'about'}, {type: 'separator'}, {label: 'Ocultar Hive', role: 'hide'}, {label: 'Ocultar outros', role: 'hideOthers'}, {label: 'Mostrar todos', role: 'unhide'}, {type: 'separator'}, {label: 'Sair do Hive', role: 'quit'}]},
		{label: 'Editar', submenu: [{label: 'Desfazer', role: 'undo'}, {label: 'Refazer', role: 'redo'}, {type: 'separator'}, {label: 'Recortar', role: 'cut'}, {label: 'Copiar', role: 'copy'}, {label: 'Colar', role: 'paste'}, {label: 'Selecionar tudo', role: 'selectAll'}]},
		{label: 'Visualizar', submenu: [{label: 'Tamanho original', role: 'resetZoom'}, {label: 'Aumentar', role: 'zoomIn'}, {label: 'Diminuir', role: 'zoomOut'}, {type: 'separator'}, {label: 'Tela cheia', role: 'togglefullscreen'}]},
		{label: 'Janela', submenu: [{label: 'Minimizar', role: 'minimize'}, {label: 'Fechar', role: 'close'}]},
	]));
	janela = new BrowserWindow({
		title: 'Hive', width: 1440, height: 960, minWidth: 760, minHeight: 560,
		backgroundColor: '#0b1015', show: false, autoHideMenuBar: process.platform !== 'darwin',
		webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, partition: `hive-${process.pid}`},
	});
	janela.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
	janela.webContents.on('will-navigate', (evento, destino) => { if (new URL(destino).origin !== origem) evento.preventDefault(); });
	janela.webContents.session.setPermissionRequestHandler((webContents, permissao, responder) => {
		responder(permissao === 'notifications' && new URL(webContents.getURL()).origin === origem);
	});
	janela.on('page-title-updated', evento => evento.preventDefault());
	janela.once('ready-to-show', () => janela.show());
	janela.webContents.on('did-fail-load', (_evento, codigo, descricao) => { if (codigo !== -3) { console.error(`hive: não foi possível carregar a interface: ${descricao}`); app.exit(1); } });
	janela.on('unresponsive', () => console.error('hive: a janela não está respondendo.'));
	janela.loadURL(link).catch(erro => { console.error(erro.message); app.exit(1); });
});
// Fechar a última janela encerra o processo; o launcher desliga o backend.
app.on('window-all-closed', () => app.quit());
