# Henrique Store

Loja de jogos com catálogo público e painel administrativo em `/admin`. Na Vercel, os jogos ficam no **Firebase Realtime Database** do projeto `lojaps5`. O painel continua usando a senha atual (`ADMIN_PASSWORD`); não usa Firebase Authentication e não exige cadastro de usuários no Firebase.

## Configurar o Firebase

1. Abra **Realtime Database → Regras**, copie o conteúdo de [`database.rules.json`](database.rules.json) e clique em **Publicar**. Essas regras substituem as regras temporárias e a configuração anterior que bloqueava todas as leituras.
2. Em **Configurações do projeto → Contas de serviço → Firebase Admin SDK**, clique em **Gerar nova chave privada**.
3. Na Vercel, em **Settings → Environment Variables**, crie `FIREBASE_SERVICE_ACCOUNT` para Production e cole o conteúdo completo do JSON baixado. Mantenha `ADMIN_PASSWORD` com a senha atual.
4. Faça um novo deploy.

A conta de serviço precisa ter acesso ao Realtime Database do projeto `lojaps5`. A configuração pública do app (`apiKey`, `appId`, etc.) não substitui essa credencial. O JSON privado deve ficar somente na variável de ambiente: não o coloque no GitHub, no JavaScript público nem na conversa.

Não é necessário configurar Blob, PostgreSQL ou `DATABASE_URL`. A URL `https://lojaps5-default-rtdb.firebaseio.com` já está no código. As antigas variáveis de Blob são ignoradas. Os dados locais ou de um Blob anterior não são migrados automaticamente.

## Regras e persistência

O catálogo fica em `/catalogue`, com `version`, `nextId` e um mapa `games`. O catálogo começa vazio. Apenas consultas filtradas por `published = true` podem ser feitas publicamente; jogos ocultos não são acessíveis pela API pública nem por uma leitura direta sem autorização no Firebase. A conta de serviço realiza as operações administrativas após a validação da sessão do painel.

Cada alteração lê a versão atual e faz uma gravação condicional com ETag. Se outra instância gravar primeiro, a operação lê novamente antes de tentar salvar. Falhas de acesso não apagam dados nem substituem o catálogo por exemplos.

No painel, **Ocultar do público** retira o jogo do catálogo e do banner sem apagar seus dados. **Publicar** volta a exibi-lo. **Excluir** remove o jogo após confirmação. Para publicar um jogo, preencha o link HTTPS do Google Drive e as instruções de instalação.

## Rodar no computador

Com Node.js 22:

```powershell
npm install
npm start
```

Loja: `http://localhost:3000`. Painel: `http://localhost:3000/admin`.

Por padrão, o modo local usa `data/catalogue.json`. A senha fica em `data/senha-admin.txt` ou em `ADMIN_PASSWORD` (12 a 256 caracteres). Execute apenas um processo local para essa pasta e faça backup de `data/`.

Para usar o Firebase também localmente, defina `STORE_BACKEND=firebase` e `FIREBASE_SERVICE_ACCOUNT` no ambiente do processo. Na Vercel, o Firebase é sempre usado, independentemente de `STORE_BACKEND`. Arquivos `.env` não são carregados automaticamente pelo comando `npm start`.

## Testes e sessões

```powershell
npm test
```

Os testes cobrem autenticação por senha, proteção das rotas, armazenamento local e a integração REST do Firebase com respostas simuladas: assinatura da credencial, gravação, publicação, ocultação, exclusão, concorrência e falhas. Eles não alteram o banco real. A validação com o serviço real depende da credencial configurada na hospedagem.

As sessões usam cookies HttpOnly assinados, SameSite=Strict, Secure na Vercel e validade de oito horas. Logout remove o cookie do navegador; trocar `ADMIN_PASSWORD` invalida as sessões anteriores. A credencial do Firebase e seus tokens nunca são enviados ao navegador.

Referências: [autenticação REST do Firebase](https://firebase.google.com/docs/database/rest/auth), [gravações condicionais](https://firebase.google.com/docs/database/rest/save-data), [regras baseadas em consultas](https://firebase.google.com/docs/database/security/rules-conditions#query-based_rules).
