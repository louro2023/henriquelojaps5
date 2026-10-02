# Henrique Store

Loja de jogos digitais com catálogo público, busca, categorias, detalhes, download pelo Google Drive e instruções de instalação. Administração protegida por senha com criação, edição, publicação, rascunhos e exclusão. Banco SQLite no servidor: os visitantes veem o mesmo catálogo.

## Rodar no Windows

Instale Node.js 22.13 ou superior e execute na pasta do projeto:

```powershell
npm start
```

Abra http://localhost:3000. Administração: http://localhost:3000/admin.

No primeiro início é gerada uma senha em `data/senha-admin.txt`. Leia esse arquivo para entrar. A senha não é exposta no site. Como alternativa, defina a variável de ambiente `ADMIN_PASSWORD` (mínimo de 12 caracteres) antes do primeiro início. Essa variável não altera uma conta já criada.

## Cadastrar jogos

1. Entre na área administrativa e clique em **Adicionar jogo**.
2. Preencha nome, categoria, plataforma, capa HTTPS e descrição.
3. Coloque o link HTTPS do Google Drive e as orientações de instalação. No Drive, habilite o acesso para qualquer pessoa com o link.
4. Marque **Publicar na loja** e salve. Sem marcar essa opção, o jogo fica como rascunho.
5. Marque **Destacar no banner** para aparecer na abertura da loja. Se houver mais de um destaque, o cadastro mais recente tem prioridade.

Os seis jogos iniciais são exemplos visuais com imagens remotas. Não incluem arquivos ou downloads. Podem ser editados ou excluídos pelo painel. Não são recriados ao reiniciar.

## Publicar na internet

O projeto está preparado para executar em um servidor Node.js com disco persistente. Não foi publicado na internet. Configure `HOST=0.0.0.0`, `PORT` conforme a hospedagem e `COOKIE_SECURE=true` ao servir por HTTPS. Use HTTPS por meio do proxy da hospedagem. Preserve a pasta `data`, incluindo o SQLite, e faça backups. Não exponha essa pasta por um servidor de arquivos. Sessões duram oito horas e são encerradas ao reiniciar o servidor.

Esta versão entrega downloads públicos e não processa pagamentos nem controla compras. Se os jogos forem pagos, será necessário integrar um provedor de pagamento e uma biblioteca autenticada antes de disponibilizar os arquivos. Links públicos do Drive podem ser compartilhados.

## Verificação

```powershell
npm test
```

As imagens das demonstrações são carregadas do CDN da Steam e a fonte do Google Fonts. A interface mantém fontes de sistema como alternativa.
