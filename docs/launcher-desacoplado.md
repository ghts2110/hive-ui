# Launcher independente do terminal (planejado)

Registro da [issue #55](https://github.com/ghts2110/hive-ui/issues/55).
Este documento registra o trabalho futuro; o desacoplamento não está implementado.

## Situação atual

`bin/hive`, sem argumentos ou com `--gui`, executa `gui/desktop.js` em
primeiro plano. Esse processo inicia o serviço local (`gui/server.js`) e a
janela Electron (`gui/window.cjs`), acompanha sua execução e solicita o
encerramento do serviço quando a janela fecha. O prompt permanece ocupado;
o aplicativo ainda depende do terminal de origem.

O serviço local administra as conversas, o servidor tmux privado e o bloqueio
de repouso. Hoje, `Ctrl-C` no terminal de origem solicita o encerramento do
aplicativo e das conversas.

## Comportamento esperado na implementação futura

- Executar apenas `hive` abre a janela e devolve o prompt assim que a abertura
  for concluída.
- Fechar o terminal de origem mantém a janela, os agentes e as conversas em
  andamento funcionando.
- Fechar a janela ou sair do Hive encerra o serviço local, os agentes, o
  servidor tmux privado e o bloqueio de repouso daquela execução, sem deixar
  processos órfãos nem afetar outras execuções.
- Falhas na inicialização aparecem no terminal e provocam a limpeza dos
  processos iniciados parcialmente.
- `hive --terminal` mantém seu comportamento atual, vinculado ao terminal.

## Pontos para a implementação

O processo responsável pelo ciclo de vida do aplicativo precisará sobreviver
ao fechamento do terminal, sem depender dos descritores de entrada e saída
dele. O launcher deverá aguardar uma confirmação de abertura da janela antes
de devolver o prompt; hoje a mensagem de abertura é emitida ao iniciar o
processo Electron, antes do evento `ready-to-show`.

A confirmação de abertura, os erros e o prazo de inicialização precisam de
um canal de comunicação com o launcher. Após essa etapa, o encerramento e a
limpeza devem continuar sob responsabilidade de um processo do aplicativo.
Somente colocar o comando em segundo plano não satisfaz esses requisitos.

## Validação da implementação futura

1. Executar `hive` em um terminal e confirmar que a janela abre e o prompt é
   liberado depois da abertura.
2. Iniciar uma conversa, fechar o terminal de origem e confirmar que a janela
   e a conversa continuam funcionando, inclusive o envio de novas mensagens.
3. Fechar a janela e verificar que o serviço local, os agentes, o servidor
   tmux privado e o bloqueio de repouso dessa execução foram encerrados.
4. Repetir usando **Sair do Hive** e com outra execução aberta, verificando
   que ela continua funcionando.
5. Provocar falhas de inicialização do serviço e da janela, incluindo o prazo
   de inicialização excedido: verificar a mensagem no terminal, a saída com
   erro e a ausência de processos iniciados parcialmente.
6. Executar `hive --terminal` e verificar que a interface continua vinculada
   ao terminal e que fechar esse terminal encerra sua sessão.

Esses passos são critérios de aceite futuros, não validações já realizadas
de um launcher desacoplado.
