-- No-op: esta migration continha dados temporarios de teste (role/perfil de um usuario especifico).
-- Removida do historico de producao. Efeito liquido no banco: nenhum (os dados de teste ja foram revertidos).
-- Dados de teste devem vir de seed local ou setup/teardown de testes, nunca de migrations.
select 1;
