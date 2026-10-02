# Henrique Store

Loja de jogos digitais com catálogo público, busca, categorias, detalhes, download pelo Google Drive e instruções de instalação. Administração protegida por senha com criação, edição, publicação, rascunhos e exclusão. Usa SQLite no computador e PostgreSQL na Vercel, com catálogo e sessões compartilhados entre visitantes e instâncias.

## Rodar no Windows

Instale Node.js 22.13 ou superior e execute na pasta do projeto:

```powershell
npm start
```

Abra http://localhost:3000. Administração: http://localhost:3000/admin.

No primeiro acesso local ao catálogo é gerada uma senha em `data/senha-admin.txt`. Leia esse arquivo para entrar. A senha não é exposta no site. Como alternativa, defina a variável de ambiente `ADMIN_PASSWORD` (12 a 256 caracteres). Quando definida, essa variável tem prioridade sobre a senha local. Alterá-la invalida as sessões anteriores após reiniciar/republicar a aplicação.

## Cadastrar jogos

1. Entre na área administrativa e clique em **Adicionar jogo**.
2. Preencha nome, categoria, plataforma, capa HTTPS e descrição.
3. Coloque o link HTTPS do Google Drive e as orientações de instalação. No Drive, habilite o acesso para qualquer pessoa com o link.
4. Marque **Publicar na loja** e salve. Sem marcar essa opção, o jogo fica como rascunho.
5. Marque **Destacar no banner** para aparecer na abertura da loja. Se houver mais de um destaque, o cadastro mais recente tem prioridade.

Os seis jogos iniciais são exemplos visuais com imagens remotas. Não incluem arquivos ou downloads. Podem ser editados ou excluídos pelo painel. Não são recriados ao reiniciar.

## Publicar na Vercel

1. Importe este repositório na Vercel. O `vercel.json` configura os arquivos estáticos e a função da API; não há compilação do frontend. Use Node.js 22.x.
2. No projeto, abra **Storage → Create Database** e conecte um PostgreSQL, por exemplo Neon pelo Marketplace. Também é possível usar um PostgreSQL existente.
3. Em **Settings → Environment Variables**, configure para **Production**:
   - `DATABASE_URL`: URL de conexão PostgreSQL com pool e TLS fornecida pelo banco. `POSTGRES_URL` também é reconhecida.
   - `ADMIN_PASSWORD`: sua senha administrativa de 12 a 256 caracteres. A senha local não é enviada para o GitHub nem copiada automaticamente para a Vercel.
4. Faça um **Redeploy** depois de configurar as variáveis. As tabelas e os exemplos são criados automaticamente na primeira consulta ao banco. Nenhum comando SQL manual é necessário.
5. Acesse `/admin` e entre com a senha configurada.

Use outro banco para Preview caso habilite administração em ambientes de teste. Não coloque credenciais em arquivos versionados.

Sem banco configurado, a loja abre com os seis exemplos, mas o login explica que falta configurar o PostgreSQL. O sistema não salva cadastros em memória ou em `/tmp`. Se um banco configurado estiver indisponível, a API retorna um erro temporário em vez de substituir o catálogo por exemplos.

O SQLite local não é compatível com a persistência das funções da Vercel. Por isso a função não cria arquivos nem importa SQLite na nuvem. Dados, sessões e limites de tentativas de login ficam no PostgreSQL. A sessão dura oito horas, funciona entre instâncias e é revogada no logout. Cookies usam `Secure` automaticamente na Vercel.

Os dados do computador (incluindo rascunhos) não são migrados automaticamente. Cadastre-os no painel online depois de conectar o banco. Para hospedagem tradicional com disco persistente, o SQLite continua disponível: configure `HOST=0.0.0.0`, `PORT` e `COOKIE_SECURE=true` com HTTPS e faça backups da pasta `data`.

Esta versão entrega downloads públicos e não processa pagamentos nem controla compras. Se os jogos forem pagos, será necessário integrar um provedor de pagamento e uma biblioteca autenticada antes de disponibilizar os arquivos. Links públicos do Drive podem ser compartilhados.

## Verificação

```powershell
npm test
```

As imagens das demonstrações são carregadas do CDN da Steam e a fonte do Google Fonts. A interface mantém fontes de sistema como alternativa.
