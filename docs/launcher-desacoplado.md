# Launcher independente do terminal

`hive` e `hive --gui` iniciam um supervisor em uma sessão independente do
terminal. O launcher aguarda a confirmação `ready-to-show` da janela antes de
liberar o prompt. Depois disso, fechar o terminal não encerra a janela nem as
conversas. O supervisor usa entrada e saída independentes do terminal.

O supervisor mantém o serviço local e a janela Electron. Fechar a janela ou
usar **Sair do Hive** solicita o encerramento do serviço, que encerra as
conversas e seu servidor tmux privado. O bloqueio de repouso acompanha o PID
do serviço. Outras execuções têm servidores tmux próprios.

Falhas de abertura são enviadas ao launcher por IPC e aparecem no terminal,
com código de saída diferente de zero. O prazo de abertura é de 20 segundos;
falha ou interrupção antes da confirmação solicita a limpeza dos filhos.
O supervisor dá cinco segundos para o encerramento antes de forçá-lo.

`hive --terminal` continua vinculado ao terminal.

## Validação

`npm run test:launcher` verifica os aliases, argumentos e o ciclo de vida com
processos simulados: liberação do launcher após a abertura, permanência dos
filhos e limpeza no fechamento ou em falha da janela.
`npm run test:gui` verifica a janela Electron e as conversas com agentes falsos.

Para verificar manualmente o ciclo completo no macOS:

1. Executar `hive` e confirmar que o prompt volta após a janela abrir.
2. Iniciar uma conversa, fechar o terminal de origem e enviar novas mensagens.
3. Fechar a janela e verificar o encerramento do serviço, dos agentes, do tmux
   privado e do bloqueio de repouso dessa execução.
4. Repetir usando **Sair do Hive**, mantendo outra execução aberta para
   confirmar que ela continua funcionando.
5. Executar `hive --terminal` e confirmar que fechar o terminal encerra a sessão.

Implementa o comportamento descrito na [issue #55](https://github.com/ghts2110/hive-ui/issues/55).
