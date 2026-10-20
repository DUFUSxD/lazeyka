// node .github/release-notes.mjs <версия> — текст релиза на GitHub: пункты этой версии из CHANGELOG.md
// и как поставить/обновиться. Используется workflow release.yml (и вручную — для старых версий).
import { readFileSync } from 'node:fs';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? '')) throw new Error('usage: node .github/release-notes.mjs <X.Y.Z>');

const lines = [];
let take = false;
for (const l of readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split(/\r?\n/)) {
  const h = l.match(/^##\s+v?(\d+\.\d+\.\d+)/);
  if (h) take = h[1] === v;
  else if (take) lines.push(l);
}
const notes = lines.join('\n').trim() || '- Улучшения и исправления';

process.stdout.write(`## Что нового

${notes}

## Как поставить или обновиться

- **Стоит Лазейка 1.2 или новее** — открой её и нажми «Обновить» (или ⚙ → «Проверки и обновления» → «Проверить сейчас»).
- **Стоит 1.0 или 1.1** — выполни в Терминале команду для Windows ниже и нажми «Перезагрузить» у Лазейки на странице расширений.
- **Ставишь впервые** — команда для своей системы ниже, дальше [пошаговая инструкция со скриншотами](https://github.com/DUFUSxD/lazeyka#установка--5-минут).

Windows (Win + X → «Терминал»):

\`\`\`powershell
irm https://raw.githubusercontent.com/DUFUSxD/lazeyka/main/install.ps1 | iex
\`\`\`

macOS и Linux (терминал):

\`\`\`sh
curl -fsSL https://raw.githubusercontent.com/DUFUSxD/lazeyka/main/install.sh | sh
\`\`\`
`);
