# Estoque extraído da Fase 3

O CRUD usa a entidade, os casos de uso e 16 testes originais (ver stock-extraction.json). As rotas administrativas mantêm criação, listagem, consulta, alteração e desativação. Operadores podem consultar somente a disponibilidade adicional. As validações reproduzem os limites originais de Int e Decimal(10,2).

Saldo físico, quantidade reservada e registros de reserva ficam em um documento MongoDB com CAS. Reserva de múltiplas peças é atômica e congela os preços. A confirmação do pagamento habilita a fila; iniciar reparo baixa estoque uma vez. Cancelar antes da baixa libera a reserva uma vez, inclusive se o comando de cancelamento chegar primeiro. A baixa já registrada exige reconciliação manual se o reparo precisar ser cancelado.

A atualização do estoque e o agregado da execução são transações locais distintas. O registro idempotente do estoque permite retomar a mesma operação se o processo falhar entre elas. Em uma nova tentativa após recusa, usa-se novo identificador, de modo que a reserva anterior continue fechada. Há testes com MongoDB real para disputas por saldo/SKU, cancelamento concorrente e reconexão após falha.

O documento único é uma escolha para o volume da demonstração e para Mongo standalone. Para escala, será preciso particionar o estoque ou adotar transações com replica set, além de política de retenção; o limite BSON permanece. A importação funciona em modo simulação por padrão e rejeita dados divergentes ou saldo já reservado.
