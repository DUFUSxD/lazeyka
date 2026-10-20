// Поиск серверов по стране: «Британия» находит «🇬🇧 London», «UK-1», «United Kingdom», «Великобритания».
// Названия стран на русском и английском знает сам браузер (Intl.DisplayNames по коду, он же — флаг);
// здесь только то, чего в официальных названиях нет: разговорные имена и крупные города с VPN-серверами.
const EXTRA = {
  GB: 'britain, great britain, england, london, manchester, британия, англия, лондон, манчестер',
  US: 'usa, america, new york, los angeles, chicago, dallas, miami, seattle, san jose, ashburn, сша, америка, штаты, нью-йорк, лос-анджелес, чикаго, даллас, майами, сиэтл',
  NL: 'holland, amsterdam, голландия, амстердам',
  DE: 'frankfurt, berlin, munich, nuremberg, falkenstein, франкфурт, берлин, мюнхен, нюрнберг',
  FI: 'helsinki, хельсинки',
  FR: 'paris, париж',
  SE: 'stockholm, стокгольм',
  NO: 'oslo, осло',
  PL: 'warsaw, варшава',
  AT: 'vienna, вена',
  CH: 'zurich, цюрих',
  CZ: 'czech, prague, прага',
  IT: 'milan, rome, милан, рим',
  ES: 'madrid, мадрид',
  TR: 'turkey, istanbul, стамбул',
  AE: 'uae, emirates, dubai, эмираты, дубай',
  IL: 'tel aviv, тель-авив',
  RU: 'рф, moscow, spb, saint petersburg, москва, питер, санкт-петербург',
  KZ: 'almaty, astana, алматы, астана',
  BY: 'белоруссия, minsk, минск',
  MD: 'молдавия, chisinau, кишинев',
  UA: 'kyiv, kiev, киев',
  GE: 'tbilisi, тбилиси',
  AM: 'yerevan, ереван',
  LV: 'riga, рига',
  LT: 'vilnius, вильнюс',
  EE: 'tallinn, таллин',
  JP: 'tokyo, osaka, токио, осака',
  KR: 'korea, seoul, корея, сеул',
  HK: 'hong kong, hongkong, гонконг',
  CA: 'toronto, montreal, vancouver, торонто, монреаль, ванкувер',
  AU: 'sydney, melbourne, сидней, мельбурн',
  IN: 'mumbai, мумбаи',
  BR: 'sao paulo, сан-паулу',
  ZA: 'юар',
};

const lc = (v) => v.toLowerCase().replaceAll('ё', 'е');
const flagOf = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))); // A → 🇦

// [{ codes: ['gb', 'uk'], flag: '🇬🇧', words: ['великобритания', 'united kingdom', 'britain', …] }] — один раз на окно
let countries;
function countryList() {
  if (countries) return countries;
  const names = ['ru', 'en'].map((l) => new Intl.DisplayNames([l], { type: 'region', fallback: 'none' }));
  const byCode = new Map();
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const [ru, en] = names.map((d) => d.of(code));
      if (!en || code === 'ZZ') continue;
      // устаревшие коды — к действующему: UK → GB, DD → DE, FX → FR (иначе «Германия» досталась бы ГДР без флага 🇩🇪)
      const main = Intl.getCanonicalLocales(`und-${code}`)[0].slice(4);
      const c = byCode.get(main) ?? byCode.set(main, { codes: [], flag: flagOf(main), words: (EXTRA[main] ?? '').split(',') }).get(main);
      c.codes.push(lc(code));
      c.words.push(ru ?? '', en);
    }
  }
  countries = [...byCode.values()];
  for (const c of countries) c.words = [...new Set(c.words.map((w) => lc(w).trim()).filter(Boolean))];
  return countries;
}

// Фильтр по строке поиска. Короткий запрос, совпавший с кодом или синонимом («uk», «us», «de», «сша»), ищет только
// эту страну — иначе «uk» нашёл бы Ukraine, а «us» — Russia. Короткие слова сверяются целиком, длинные — подстрокой.
export function serverFilter(query) {
  const q = lc(query.trim());
  if (!q) return () => true;
  const list = countryList();
  const exact = list.filter((c) => c.codes.includes(q) || (q.length <= 3 && c.words.includes(q)));
  const found = exact.length ? exact : q.length < 3 ? []
    : list.filter((c) => c.words.some((w) => w.startsWith(q) || (q.length >= 4 && w.includes(q))));
  const flags = found.map((c) => c.flag);
  const short = found.flatMap((c) => [...c.codes, ...c.words.filter((w) => w.length <= 3)]);
  const long = found.flatMap((c) => c.words.filter((w) => w.length > 3));
  return (name) => {
    const n = lc(name);
    if (!exact.length && n.includes(q)) return true;
    if (flags.some((f) => n.includes(f)) || long.some((w) => n.includes(w))) return true;
    const parts = n.split(/[^\p{L}\p{N}]+/u);
    return short.some((w) => parts.includes(w));
  };
}
