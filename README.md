# ForjaFit — PWA / APK Android de Musculação

Aplicativo progressivo (PWA) 100% offline-first para controle de fichas de musculação, progressão de cargas, cronômetro de descanso automático, cálculo de volume/1RM e acompanhamento semanal.

## Estrutura do Projeto

```text
forjafit/
├── index.html               # Entrada principal mobile-first
├── manifest.webmanifest     # Manifesto PWA (caminhos relativos para GitHub Pages)
├── sw.js                    # Service Worker com cache offline completo
├── assets/icons/            # Ícones PNG 192px, 512px e maskable 512px
├── css/
│   ├── tokens.css           # Design tokens (tema escuro verde-petróleo + verde-lima neon)
│   ├── base.css             # Reset e layout base mobile
│   └── components.css       # Cards, bottom nav flutuante, bottom sheets e pickers
├── data/
│   ├── exercises.json       # Catálogo com 333 exercícios em português + metadados musculares
│   └── plans.json           # Ficha inicial, treinos rápidos e planos prontos
└── js/
    ├── db.js                # Persistência offline via IndexedDB + Export/Import JSON
    ├── domain.js            # Volume bilateral/unilateral, 1RM (Epley), calorias, PRs e streak
    ├── muscle-map.js        # Mapas anatômicos SVG (frente/costas) e ícones de equipamentos
    ├── timer.js             # Cronômetro da sessão, timer de descanso, Web Audio e vibração
    └── app.js               # Controlador principal das 5 abas e modais
```

## Créditos

Exercise data by [RepDB (repdb.co)](https://repdb.co). As ilustrações em `assets/exercises/` seguem a licença gratuita do RepDB: uso somente dentro do app, com este crédito visível, e sem redistribuição como banco de dados ou uso em modelos generativos.

## 1. Testando localmente (VS Code)

1. Extraia a pasta `forjafit` e abra no **VS Code**.
2. Clique com o botão direito em `index.html` → **Open with Live Server**.
3. No navegador (Chrome/Edge), pressione `F12` e ative o modo celular (`Ctrl+Shift+M`) para visualizar a ergonomia mobile.

## 2. Publicando no GitHub Pages

> **Importante para o APK:** o Android só remove a barra de endereço se encontrar `/.well-known/assetlinks.json` na **raiz do domínio**. Em `https://SEU_USUARIO.github.io/forjafit/` esse arquivo ficaria no lugar errado. Por isso, publique em um repositório chamado exatamente `SEU_USUARIO.github.io` ou use um domínio próprio.

1. Crie o repositório `SEU_USUARIO.github.io` no GitHub.
2. Suba todos os arquivos desta pasta para a branch `main`, incluindo o `.nojekyll`, que permite publicar a pasta `.well-known`.
3. Em **Settings → Pages**, selecione `Deploy from a branch` → `main` → `/ (root)`.
4. Aguarde ~1 minuto e acesse `https://SEU_USUARIO.github.io/`.
   * Todos os caminhos usam `./` relativo para evitar erro 404 no `manifest.webmanifest` e nos ícones.

## 3. Gerando o APK Android (PWABuilder / Bubblewrap)

1. Acesse [pwabuilder.com](https://www.pwabuilder.com/) e cole a URL do seu GitHub Pages.
2. Confirme que **Manifest** e **Service Worker** estão verdes.
3. Clique em **Package for Stores → Android → Generate Package** (TWA / Bubblewrap).
4. Guarde o arquivo de assinatura (`signing.keystore`) e as senhas em local seguro e **fora do repositório**. Sem eles não é possível atualizar o app.
5. Publique o `assetlinks.json` gerado em `.well-known/assetlinks.json` na raiz do site.
6. Instale o `.apk` no celular Android (habilitando *Instalar apps desconhecidos* se necessário).

## 4. Publicando uma atualização

Altere `CACHE_NAME` em `sw.js` a cada publicação. Em produção o app usa somente o cache dessa versão, então **sem essa troca o celular continua na versão antiga**. Arquivos novos também precisam entrar em `CORE_ASSETS`.
