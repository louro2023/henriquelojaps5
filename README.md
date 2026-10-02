# Henrique Store

Loja de jogos digitais com catálogo, busca, categorias e administração por senha. O cadastro inclui capa, descrição, link do Google Drive e instruções de instalação. **Não usa banco de dados.**

## Usar no computador

Com Node.js 22.x instalado:

```powershell
npm install
npm start
```

Loja: http://localhost:3000. Painel: http://localhost:3000/admin.

A senha local fica em `data/senha-admin.txt`; se não existir, é criada ao tentar entrar. Você também pode definir `ADMIN_PASSWORD` (12 a 256 caracteres), que tem prioridade sobre o arquivo. O catálogo é salvo em `data/catalogue.json`. Faça backup da pasta `data`, que não é publicada no GitHub nem servida pela aplicação. Execute apenas um processo local para essa pasta.

## Acessar o painel na Vercel

1. Importe o repositório na Vercel. O `vercel.json` configura a página e a API.
2. Em **Settings → Environment Variables**, defina `ADMIN_PASSWORD` para Production com sua senha.
3. Faça **Redeploy** e acesse `/admin`.

**O login e a visualização do painel não exigem PostgreSQL, SQLite, DATABASE_URL nem Blob.** A senha nunca é enviada pelo GitHub; deve ser definida diretamente na hospedagem. As antigas variáveis de banco não são mais utilizadas.

## Salvar jogos online sem banco de dados

Os jogos ficam em um arquivo JSON. No computador, ele é gravado em disco. Na Vercel, o disco da função não é persistente, então o arquivo deve ficar em um **Vercel Blob privado**, que é armazenamento de arquivos:

1. Abra **Storage** no projeto, crie um **Blob store privado** e conecte ao projeto.
2. Confira se a conexão adicionou `BLOB_READ_WRITE_TOKEN` às variáveis de Production.
3. Faça **Redeploy**.

Pronto: o painel salva `henrique-store/catalogue.json` no Blob, e todos os visitantes consultam o mesmo catálogo. O token só é utilizado pelo servidor. Rascunhos ficam no arquivo privado e não são retornados pela API pública. Atualizações usam a versão do arquivo (ETag) para evitar sobrescrever gravações simultâneas.

Sem Blob, o painel continua acessível e mostra um aviso de que a gravação ainda não está disponível; nenhuma alteração é apresentada como salva. O catálogo público mostra os exemplos. Não há gravação em `/tmp` nem dependência de localStorage para compartilhar jogos. Uma falha no Blob gera erro temporário, sem substituir os dados por exemplos.

Os jogos do computador não são enviados automaticamente ao Blob. O SQLite da versão anterior pode ser mantido como backup; esta versão não o utiliza.

## Cadastrar jogos

Entre no painel e clique em **Adicionar jogo**. Preencha nome, categoria, plataforma, capa HTTPS, descrição, link HTTPS do Google Drive e orientações de instalação. Habilite o compartilhamento do arquivo no Drive. Marque **Publicar na loja** e salve; sem marcar essa opção, o jogo fica como rascunho. O destaque mais recente aparece no banner.

Os seis jogos iniciais são demonstrações sem download. Podem ser editados ou excluídos. Não são recriados após a gravação de um catálogo vazio.

Na lista do administrador, **Ocultar do público** remove o jogo da loja e do banner sem apagar seus dados. Ele continua disponível no painel com status **Oculto**; use **Publicar** para exibi-lo novamente. Exclusão e alterações de visibilidade na Vercel exigem o Blob configurado acima. Erros de exclusão aparecem na própria janela de confirmação.

## Sessões e testes

As sessões são cookies HttpOnly assinados, com duração de oito horas, SameSite=Strict e Secure na Vercel. Funcionam entre instâncias sem armazenar sessões no servidor. Logout remove o cookie do navegador; uma cópia anterior do token permanece válida até expirar. Trocar `ADMIN_PASSWORD` e republicar invalida as assinaturas anteriores. O limitador de login em memória é por instância; regras globais adicionais podem ser configuradas no firewall da Vercel.

```powershell
npm test
```

Os testes verificam login sem banco, assinatura das sessões, criação/publicação/exclusão, proteção do painel e persistência em JSON.

Esta versão entrega downloads públicos e não processa pagamentos. Imagens de demonstração são carregadas do CDN da Steam; a fonte vem do Google Fonts, com fontes locais como alternativa.
