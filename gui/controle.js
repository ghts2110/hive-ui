// Mantém o servidor privado vivo enquanto a interface gráfica está aberta.
process.on('SIGUSR2', () => {});
setInterval(() => {}, 60_000);
