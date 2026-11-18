(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const rawNames = (typeof NamesRu !== 'undefined' ? NamesRu : (globalThis.NamesRu || { M: [], F: [] }));
  const MALE_NAMES = new Set((rawNames.M || []).map((n) => n.toLowerCase().replace(/ё/g, 'е')));
  const FEMALE_NAMES = new Set((rawNames.F || []).map((n) => n.toLowerCase().replace(/ё/g, 'е')));

  const DEFAULT_DICTIONARY = [
    'Авдотья=Евдокия', 'Овдотья=Евдокия', 'Аграфена=Агриппина', 'Агрофена=Агриппина',
    'Аксинья=Ксения', 'Акулина=Акилина', 'Арина=Ирина', 'Афанасей=Афанасий',
    'Василей=Василий', 'Гаврила=Гавриил', 'Гаврило=Гавриил', 'Григорей=Григорий',
    'Давыд=Давид', 'Данила=Даниил', 'Данило=Даниил', 'Егор=Георгий', 'Егорий=Георгий',
    'Емельян=Емилиан', 'Козма=Косьма', 'Кузма=Косьма', 'Кузьма=Косьма',
    'Лукерья=Гликерия', 'Маланья=Мелания', 'Марья=Мария', 'Матрена=Матрона',
    'Михайла=Михаил', 'Михайло=Михаил', 'Настасья=Анастасия', 'Осип=Иосиф',
    'Палагея=Пелагея', 'Прасковья=Параскева', 'Семен=Симеон', 'Степан=Стефан',
    'Ульяна=Иулиания', 'Федор=Феодор', 'Феврония=Февронья'
  ].join('\n');

  const DEFAULT_SETTINGS = {
    textMode: 'substitute',
    stitchMode: 'joined',
    fixOldSpelling: true,
    substitutePatronymic: true,
    substituteBirthYear: true,
    nameDictionary: DEFAULT_DICTIONARY,
    borderWidth: 2,
    buttonsPosition: 'bottom',
    enabledButtons: ['copy_sel_clip', 'copy_sel_new_file', 'copy_sel_open_file', 'copy_all_clip', 'copy_all_new_file', 'copy_all_open_file'],
    theme: 'system',
    textColor: '#1f2328',
    selectionBgColor: '#ffd33d',
    selectionTextColor: '#000000'
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let openFileHandle = null;
  let lastLoadedUrl = '';
  let lastExtractedData = null;
  let lastDebugLog = [];

  const BUTTON_DEFS = {
    copy_sel_clip:      { label: 'Выделение → Буфер',        action: () => handleExport('selection', 'clipboard') },
    copy_sel_new_file:  { label: 'Выделение → Новый TXT',    action: () => handleExport('selection', 'new_file') },
    copy_sel_open_file: { label: 'Выделение → Открытый TXT', action: () => handleExport('selection', 'open_file') },
    copy_all_clip:      { label: 'Весь текст → Буфер',       action: () => handleExport('all', 'clipboard') },
    copy_all_new_file:  { label: 'Весь текст → Новый TXT',   action: () => handleExport('all', 'new_file') },
    copy_all_open_file: { label: 'Весь текст → Открытый TXT',action: () => handleExport('all', 'open_file') }
  };

  const cleanText = (s) => (s || '').replace(/[ \t\u00A0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const MONTHS_RX = /январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр/i;

  function rectOf(e) { return e.getBoundingClientRect(); }
  function isVisible(e) {
    if (!e || e.id === 'ya-helper-window' || e.closest('#ya-helper-window')) return false;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = rectOf(e);
    return r.width > 0 && r.height > 0;
  }

  function findViewer() {
    const list = [...document.querySelectorAll('canvas, img, svg')]
      .filter((e) => isVisible(e))
      .map((e) => ({ e, r: rectOf(e) }))
      .filter((x) => x.r.width > 200 && x.r.height > 200)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    return list.length ? list[0].r : null;
  }

  function findAutoTextContainer() {
    const vr = findViewer();
    const minLeft = vr ? vr.right - 20 : window.innerWidth * 0.4;
    const skip = new Set(['SCRIPT', 'STYLE', 'CANVAS', 'IMG', 'SVG', 'NOSCRIPT', 'HEAD', 'HTML', 'BODY']);
    const cands = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (skip.has(e.tagName.toUpperCase())) continue;
      if (e.id === 'ya-helper-window' || e.closest('#ya-helper-window')) continue;
      const r = rectOf(e);
      if (r.width < 100 || r.height < 60 || r.left < minLeft) continue;
      if (!isVisible(e)) continue;
      const t = e.innerText || '';
      if (t.trim().length < 20) continue;
      cands.push({ e, len: t.length, area: r.width * r.height });
    }
    if (!cands.length) return null;
    const maxLen = Math.max(...cands.map((c) => c.len));
    const good = cands.filter((c) => c.len >= maxLen * 0.85).sort((a, b) => a.area - b.area);
    return good[0].e;
  }

  function findAutoDate() {
    const vr = findViewer();
    if (!vr) return '';
    const cands = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (e.id === 'ya-helper-window' || e.closest('#ya-helper-window')) continue;
      const r = rectOf(e);
      if (r.width < 20 || r.height < 8 || r.bottom > vr.top + 4) continue;
      if (r.right < vr.left || r.left > vr.right) continue;
      if (vr.top - r.bottom > 300) continue;
      if (!isVisible(e)) continue;
      const t = cleanText(e.innerText);
      if (t.length < 4 || t.length > 200 || t.includes('\n')) continue;
      if (!/(?<!\d)1[5-9]\d\d(?!\d)/.test(t)) continue;
      cands.push({ e, t, bottom: r.bottom, score: (MONTHS_RX.test(t) ? 2 : 0) + (/г\.|года|год/i.test(t) ? 1 : 0) });
    }
    const leaf = cands.filter((c) => !cands.some((o) => o !== c && c.e.contains(o.e)));
    leaf.sort((a, b) => b.score - a.score || b.bottom - a.bottom);
    return leaf.length ? leaf[0].t : '';
  }

  async function extractFromNextData() {
    const wantPageMatch = location.pathname.match(/\/catalog\/[^/]+\/(\d+)\/?$/);
    const wantPage = wantPageMatch ? parseInt(wantPageMatch[1], 10) : null;
    const parseNode = (data) => {
      if (!data) return null;
      const props = data.props && data.props.pageProps ? data.props.pageProps : data;
      const n = props.currentNode || null;
      if (!n || (!Array.isArray(n.textBlocks) && !Array.isArray(n.joinedTextBlocks))) return null;
      const dn = parseInt(props.docNumber !== undefined ? props.docNumber : (data.query || {}).docNumber, 10);
      if (wantPage !== null && !Number.isNaN(dn) && dn !== wantPage) return null;
      return {
        sheetPageNumber: n.sheetPageNumber || wantPage || '',
        joinedTextBlocks: n.joinedTextBlocks || [],
        textBlocks: n.textBlocks || [],
        crumbs: (props.breadcrumbs || []).map((c) => c.code || c.name).filter(Boolean)
      };
    };
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (el) {
        const node = parseNode(JSON.parse(el.textContent));
        if (node) return node;
      }
    } catch (e) {}
    try {
      const r = await fetch(location.href, { credentials: 'include' });
      const html = await r.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) {
        const node = parseNode(JSON.parse(m[1]));
        if (node) return node;
      }
    } catch (e) {}
    return null;
  }

  function stitchDomContainer(container) {
    if (!container) return [];
    const blocks = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const val = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!val || !node.parentElement || !isVisible(node.parentElement)) continue;
      const r = node.parentElement.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      blocks.push({ t: val, x: r.left, y: r.top, h: r.height });
    }
    if (!blocks.length) return cleanText(container.innerText).split('\n').filter(Boolean);
    blocks.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
    const hs = blocks.map((b) => b.h).sort((a, b) => a - b);
    const medH = hs[Math.floor(hs.length / 2)] || 12;
    const tol = Math.max(3, medH * 0.5);
    const rows = [];
    for (const b of blocks) {
      const cy = b.y + b.h / 2;
      const last = rows[rows.length - 1];
      if (last && Math.abs(cy - last.cy) <= tol) last.items.push(b);
      else rows.push({ cy, items: [b] });
    }
    return rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      return r.items.map((i) => i.t).join(' ');
    });
  }

  async function collectPageData() {
    const dateStr = findAutoDate();
    const yearMatch = (dateStr || document.title || '').match(/\b(1[5-9]\d{2})\b/);
    const docYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const nextNode = await extractFromNextData();
    if (nextNode) {
      const joinedSegments = (nextNode.joinedTextBlocks || []).map((b) => cleanText(typeof b === 'string' ? b : (b.text || ''))).filter(Boolean);
      const lineSegments = (nextNode.textBlocks || []).map((b) => cleanText(typeof b === 'string' ? b : (b.text || ''))).filter(Boolean);
      return { source: '__NEXT_DATA__', crumbs: nextNode.crumbs.join(' / '), dateStr, docYear, joinedSegments: joinedSegments.length ? joinedSegments : lineSegments, lineSegments: lineSegments.length ? lineSegments : joinedSegments };
    }
    const domEl = findAutoTextContainer();
    const domLines = stitchDomContainer(domEl);
    return { source: 'DOM-сегмент', crumbs: '', dateStr, docYear, joinedSegments: domLines, lineSegments: domLines };
  }

  function normOldOrthography(word) {
    return word
      .normalize('NFC')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[ѣѢ]/g, 'е')
      .replace(/[іІiIїЇ]/g, 'и')
      .replace(/[ѳѲ]/g, 'ф')
      .replace(/[ѯѮ]/g, 'кс')
      .replace(/[ѱѰ]/g, 'пс')
      .replace(/[ѵѴ]/g, 'и')
      .replace(/ъ$/g, '');
  }

  function convertOldOrthographyToken(token) {
    let res = token
      .normalize('NFC')
      .replace(/Ѣ/g, 'Е').replace(/ѣ/g, 'е')
      .replace(/[ІЇ]/g, 'И').replace(/[ії]/g, 'и')
      .replace(/Ѳ/g, 'Ф').replace(/ѳ/g, 'ф')
      .replace(/Ѯ/g, 'Кс').replace(/ѯ/g, 'кс')
      .replace(/Ѱ/g, 'Пс').replace(/ѱ/g, 'пс')
      .replace(/Ѵ/g, 'И').replace(/ѵ/g, 'и');

    if (/[А-ЯЁа-яё]/.test(res)) {
      res = res.replace(/I/g, 'И').replace(/i/g, 'и');
    }

    res = res.replace(/([бвгджзклмнпрстфхцчшщБВГДЖЗКЛМНПРСТФХЦЧШЩ])[ъЪ]$/g, '$1');
    return res;
  }

  function buildDictionaryMap(dictText) {
    const map = new Map();
    (dictText || '').split('\n').forEach((line) => {
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const from = normOldOrthography(line.slice(0, idx).trim());
      const to = line.slice(idx + 1).trim();
      if (from && to) map.set(from, to);
    });
    return map;
  }

  function isKnownName(word) {
    const norm = normOldOrthography(word);
    return MALE_NAMES.has(norm) || FEMALE_NAMES.has(norm);
  }

  function isFemaleName(word) {
    const norm = normOldOrthography(word);
    if (FEMALE_NAMES.has(norm)) return true;
    if (MALE_NAMES.has(norm)) return false;
    return norm.endsWith('а') || norm.endsWith('я');
  }

  function capitalize(word) {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  function generalizePeasantPatronymic(fatherWord, isFemale, dictMap) {
    let clean = convertOldOrthographyToken(fatherWord).trim();
    if (!clean) return '';

    const possMatch = clean.match(/^(.+?)(ов|ев|ин|ын)[аоые]?$/i);
    if (possMatch) {
      let stem = possMatch[1];
      const suffix = possMatch[2].toLowerCase();
      const normStem = normOldOrthography(stem);
      if (dictMap && dictMap.has(normStem)) {
        stem = dictMap.get(normStem);
      }
      const base = capitalize(stem) + suffix;
      return isFemale ? `${base}а` : base;
    }

    const norm = normOldOrthography(clean);
    if (norm.length < 3) return '';

    if (norm.endsWith('ия') || norm.endsWith('ья')) {
      const stem = capitalize(clean.slice(0, -2)) + 'ьев';
      return isFemale ? `${stem}а` : stem;
    }
    if (norm.endsWith('ея') || norm.endsWith('ая')) {
      const stem = capitalize(clean.slice(0, -1)) + 'ев';
      return isFemale ? `${stem}а` : stem;
    }
    if (norm.endsWith('ы') || norm.endsWith('и')) {
      const stem = capitalize(clean.slice(0, -1)) + 'ин';
      return isFemale ? `${stem}а` : stem;
    }
    if (norm.endsWith('а')) {
      let baseName = clean.slice(0, -1);
      const normBase = normOldOrthography(baseName);
      if (dictMap && dictMap.has(normBase)) {
        baseName = dictMap.get(normBase);
      }
      const stem = capitalize(baseName) + 'ов';
      return isFemale ? `${stem}а` : stem;
    }
    return '';
  }

  function applyTextTransform(segment, docYear, logBucket) {
    if (!segment || currentSettings.textMode === 'original') return segment;
    let text = segment;
    const dictMap = buildDictionaryMap(currentSettings.nameDictionary);

    const WORD_RX = /[А-ЯЁа-яёѢѣІіЇїѲѳѮѯѰѱѴѵЪъЬьIi]+/g;
    text = text.replace(WORD_RX, (token) => {
      let current = token;
      if (currentSettings.fixOldSpelling) {
        const modern = convertOldOrthographyToken(current);
        if (modern !== current) {
          if (logBucket) logBucket.push(`  [Орфография] "${current}" -> "${modern}"`);
          current = modern;
        }
      }

      const key = normOldOrthography(current);
      if (dictMap.has(key)) {
        const repl = dictMap.get(key);
        const out = capitalize(repl);
        if (out !== current && logBucket) {
          logBucket.push(`  [Генерализация имени] "${current}" -> "${out}"`);
        }
        return out;
      }

      if (isKnownName(current) && current[0] === current[0].toLowerCase()) {
        const out = capitalize(current);
        if (logBucket) logBucket.push(`  [Регистр имени] "${current}" -> "${out}"`);
        return out;
      }

      return current;
    });

    if (currentSettings.textMode === 'substitute') {
      if (currentSettings.substitutePatronymic) {
        const W = '[А-ЯЁа-яё]+';

        const rxWithRel = new RegExp(`(${W})\s+(${W}(?:ов|ев|ин|ын)[аоые]?)\s+(сын|дочь|сына|дочери)`, 'gi');
        text = text.replace(rxWithRel, (full, firstName, fatherPoss, rel) => {
          if (!isKnownName(firstName)) return full;
          const fnCap = capitalize(firstName);
          const female = rel.toLowerCase().startsWith('доч') || isFemaleName(fnCap);
          const patr = generalizePeasantPatronymic(fatherPoss, female, dictMap);
          if (!patr) return full;
          const out = `${fnCap} ${patr}`;
          if (logBucket && out !== full) logBucket.push(`  [Генерализация ФИО] "${full}" -> "${out}"`);
          return out;
        });

        const rxWife = new RegExp(`(${W}(?:ов|ев|ин|ын)[аоые]?)\s+(жена|вдова)\s+(${W})(?:\s+(${W}(?:ов|ев|ин|ын)[аоые]?))?`, 'gi');
        text = text.replace(rxWife, (full, husbandPoss, role, wifeName, wifeFatherPoss) => {
          const husbandGen = generalizePeasantPatronymic(husbandPoss, true, dictMap) || capitalize(husbandPoss);
          const wifeCap = capitalize(wifeName);
          let wifePatr = '';
          if (wifeFatherPoss) {
            const p = generalizePeasantPatronymic(wifeFatherPoss, true, dictMap);
            if (p) wifePatr = ` ${p}`;
          }
          const out = `${husbandGen} ${role.toLowerCase()} ${wifeCap}${wifePatr}`;
          if (logBucket && out !== full) logBucket.push(`  [Жена/вдова XIX в.] "${full}" -> "${out}"`);
          return out;
        });

        const rxPair = new RegExp(`(${W})\s+(${W}(?:ов|ев|ин|ын)[аоые]?)(?!\s+(?:сын|дочь|сына|дочери|жена|вдова))`, 'gi');
        text = text.replace(rxPair, (full, firstName, fatherPoss) => {
          if (!isKnownName(firstName)) return full;
          const fnCap = capitalize(firstName);
          const female = isFemaleName(fnCap);
          const possLow = fatherPoss.toLowerCase();
          if (female && !/[аые]$/.test(possLow)) return full;
          if (!female && /[аые]$/.test(possLow)) return full;

          const patr = generalizePeasantPatronymic(fatherPoss, female, dictMap);
          if (!patr) return full;
          const out = `${fnCap} ${patr}`;
          if (logBucket && out !== full) logBucket.push(`  [Генерализация пары] "${full}" -> "${out}"`);
          return out;
        });

        const rxGen = new RegExp(`(^|[^А-ЯЁа-яё])(сын|дочь)\s+(${W})`, 'gi');
        text = text.replace(rxGen, (full, prefix, rel, fatherGen) => {
          const female = rel.toLowerCase().startsWith('доч');
          const patr = generalizePeasantPatronymic(fatherGen, female, dictMap);
          if (!patr) return full;
          const out = `${prefix}${rel} ${capitalize(fatherGen)} [${patr}]`;
          if (logBucket) logBucket.push(`  [Сын/дочь + род.п.] "${full.trim()}" -> "${out.trim()}"`);
          return out;
        });
      }

      if (currentSettings.substituteBirthYear && docYear) {
        text = text.replace(/(\d{1,3})\s*(?:лет|года|год)/gi, (full, ageStr) => {
          const age = parseInt(ageStr, 10);
          if (age > 0 && age <= 110) {
            const out = `${full} [~${docYear - age} г.р.]`;
            if (logBucket) logBucket.push(`  [Год рожд.] "${full}" -> "${out}"`);
            return out;
          }
          return full;
        });
      }
    }
    return text;
  }

  function downloadDebugFile() {
    const dictMap = buildDictionaryMap(currentSettings.nameDictionary);
    const lines = [
      '=== ОТЛАДОЧНЫЙ ОТЧЁТ ЯНДЕКСАРХИВ HELPER (v1.4.0) ===',
      `Время: ${new Date().toLocaleString('ru-RU')}`,
      `URL страницы: ${location.href}`,
      `User-Agent: ${navigator.userAgent}`,
      '',
      '--- ТЕКУЩИЕ НАСТРОЙКИ ---',
      `Режим текста (textMode): ${currentSettings.textMode}`,
      `Исправление старорусской орфографии (fixOldSpelling): ${currentSettings.fixOldSpelling}`,
      `Генерализация крестьянских отчеств XIX в. (substitutePatronymic): ${currentSettings.substitutePatronymic}`,
      `Подстановка года рождения (substituteBirthYear): ${currentSettings.substituteBirthYear}`,
      `Режим сшивки (stitchMode): ${currentSettings.stitchMode}`,
      `Загружено записей в словаре генерализации: ${dictMap.size}`,
      `База мужских имён (NamesRu.M): ${MALE_NAMES.size} | женских (NamesRu.F): ${FEMALE_NAMES.size}`,
      '',
      '--- ИЗВЛЕЧЁННЫЕ ДАННЫЕ СО СТРАНИЦЫ ---',
      `Источник текста: ${lastExtractedData ? lastExtractedData.source : 'нет данных'}`,
      `Определённая дата: ${lastExtractedData ? (lastExtractedData.dateStr || 'не найдена') : 'нет'}`,
      `Определённый год документа: ${lastExtractedData ? (lastExtractedData.docYear || 'не определён') : 'нет'}`,
      `Количество сшитых блоков: ${lastExtractedData ? lastExtractedData.joinedSegments.length : 0}`,
      `Количество построчных блоков: ${lastExtractedData ? lastExtractedData.lineSegments.length : 0}`,
      '',
      '--- ЖУРНАЛ СРАБАТЫВАНИЯ ЗАМЕН И ПОДСТАНОВОК ---',
      ...(lastDebugLog.length ? lastDebugLog : ['  (Срабатываний не зафиксировано.)']),
      '',
      '--- СЫРОЙ ТЕКСТ СО СТРАНИЦЫ (ДО ОБРАБОТКИ) ---',
      ...(lastExtractedData ? lastExtractedData.joinedSegments.map((s, i) => `[Блок ${i + 1}]: ${s}`) : ['(Пусто)']),
      '',
      '--- ИТОГОВЫЙ ТЕКСТ В ОКНЕ ПОМОЩНИКА ---',
      document.getElementById('ya-helper-text')?.innerText || '(Пусто)'
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `ya-helper-debug-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Отладочный файл сохранён!');
  }

  function getExportText(scope) {
    const textBox = document.getElementById('ya-helper-text');
    if (!textBox) return null;
    if (scope === 'selection') {
      const sel = window.getSelection();
      const selectedStr = sel ? sel.toString() : '';
      if (!selectedStr.trim()) { showToast('Выделите фрагмент текста в окне помощника'); return null; }
      return selectedStr;
    }
    return textBox.innerText.trim();
  }

  async function handleExport(scope, target) {
    const content = getExportText(scope);
    if (!content) return;
    if (target === 'clipboard') {
      try { await navigator.clipboard.writeText(content); showToast(scope === 'selection' ? 'Выделение скопировано в буфер' : 'Весь текст скопирован в буфер'); }
      catch (e) { showToast('Ошибка доступа к буферу обмена'); }
      return;
    }
    if (target === 'new_file') {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.download = `yandex-archive-${stamp}.txt`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showToast('Сохранено в новый TXT файл');
      return;
    }
    if (target === 'open_file') {
      if (typeof window.showOpenFilePicker === 'function') {
        try {
          if (!openFileHandle) {
            [openFileHandle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'Текстовый файл', accept: { 'text/plain': ['.txt'] } }] });
          }
          const file = await openFileHandle.getFile();
          const prevText = await file.text();
          const writable = await openFileHandle.createWritable();
          const prefix = prevText && !prevText.endsWith('\n') ? '\n\n' : (prevText ? '\n' : '');
          await writable.write(prevText + prefix + content + '\n');
          await writable.close();
          showToast(`Дописано в файл: ${openFileHandle.name}`);
        } catch (err) {
          if (err && err.name !== 'AbortError') { openFileHandle = null; showToast('Не удалось записать в открытый файл'); }
        }
      } else {
        showToast('В Firefox прямой доступ к открытому файлу ограничен — сохранён новый TXT');
        await handleExport(scope, 'new_file');
      }
    }
  }

  function createFloatingWindow() {
    if (document.getElementById('ya-helper-window')) return;
    const win = document.createElement('div');
    win.id = 'ya-helper-window';
    win.innerHTML = `
      <div id="ya-helper-header">
        <div id="ya-helper-title-wrap">
          <span>ЯндексАрхив Helper</span>
          <span id="ya-helper-subtitle">Ожидание текстового сегмента...</span>
        </div>
        <div id="ya-helper-header-controls">
          <select id="yah-quick-mode" class="yah-mode-select" title="Режим обработки текста">
            <option value="original">Оригинал</option>
            <option value="replace">Замена</option>
            <option value="substitute">Подстановка</option>
          </select>
          <button class="yah-icon-btn" id="yah-debug-btn" title="Сохранить отладочный файл для анализа ошибок">🐞</button>
          <button class="yah-icon-btn" id="yah-refresh-btn" title="Перечитать текст со страницы">↻</button>
          <button class="yah-icon-btn" id="yah-file-reset-btn" title="Сменить целевой открытый TXT файл">📂</button>
          <button class="yah-icon-btn" id="yah-options-btn" title="Открыть настройки расширения">⚙</button>
          <button class="yah-icon-btn" id="yah-toggle-btn" title="Свернуть / Развернуть окно">—</button>
        </div>
      </div>
      <div id="ya-helper-body" class="pos-bottom">
        <div id="ya-helper-text" contenteditable="true" spellcheck="false"></div>
        <div id="ya-helper-toolbar"></div>
      </div>
      <div id="ya-helper-toast"></div>
    `;
    document.body.appendChild(win);
    initDrag(win, document.getElementById('ya-helper-header'));

    const modeSelect = document.getElementById('yah-quick-mode');
    modeSelect.value = currentSettings.textMode;
    modeSelect.addEventListener('change', async (e) => {
      currentSettings.textMode = e.target.value;
      await api.storage.local.set({ textMode: currentSettings.textMode });
      if (lastExtractedData) renderTextToWindow(lastExtractedData);
    });

    document.getElementById('yah-debug-btn').addEventListener('click', downloadDebugFile);
    document.getElementById('yah-refresh-btn').addEventListener('click', () => refreshContent(true));
    document.getElementById('yah-file-reset-btn').addEventListener('click', () => { openFileHandle = null; showToast('Выбор открытого TXT файла сброшен'); });
    document.getElementById('yah-options-btn').addEventListener('click', () => { if (api.runtime && api.runtime.openOptionsPage) api.runtime.openOptionsPage(); });
    let collapsed = false, savedHeight = '550px';
    document.getElementById('yah-toggle-btn').addEventListener('click', () => {
      collapsed = !collapsed;
      const body = document.getElementById('ya-helper-body');
      if (collapsed) { savedHeight = win.style.height || `${win.offsetHeight}px`; body.style.display = 'none'; win.style.height = 'auto'; win.style.resize = 'none'; }
      else { body.style.display = 'flex'; win.style.height = savedHeight; win.style.resize = 'both'; }
    });
    applyAppearance();
    refreshContent(true);
  }

  function initDrag(win, header) {
    let dragging = false, startX = 0, startY = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      dragging = true;
      const rect = win.getBoundingClientRect();
      startX = e.clientX - rect.left; startY = e.clientY - rect.top;
      win.style.right = 'auto'; win.style.bottom = 'auto';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const maxLeft = Math.max(0, window.innerWidth - 120);
      const maxTop = Math.max(0, window.innerHeight - 40);
      win.style.left = `${Math.min(maxLeft, Math.max(0, e.clientX - startX))}px`;
      win.style.top = `${Math.min(maxTop, Math.max(0, e.clientY - startY))}px`;
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  function applyAppearance() {
    const win = document.getElementById('ya-helper-window');
    if (!win) return;
    let theme = currentSettings.theme;
    if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    win.setAttribute('data-theme', theme);
    win.style.setProperty('--yah-border-width', `${currentSettings.borderWidth}px`);
    win.style.setProperty('--yah-text-color', currentSettings.textColor);
    win.style.setProperty('--yah-sel-bg', currentSettings.selectionBgColor);
    win.style.setProperty('--yah-sel-color', currentSettings.selectionTextColor);
    const modeSelect = document.getElementById('yah-quick-mode');
    if (modeSelect) modeSelect.value = currentSettings.textMode;
    const body = document.getElementById('ya-helper-body');
    body.className = `pos-${currentSettings.buttonsPosition}`;
    const toolbar = document.getElementById('ya-helper-toolbar');
    toolbar.innerHTML = '';
    (currentSettings.enabledButtons || []).forEach((key) => {
      const def = BUTTON_DEFS[key];
      if (!def) return;
      const btn = document.createElement('button');
      btn.className = 'yah-action-btn';
      btn.textContent = def.label;
      btn.addEventListener('click', def.action);
      toolbar.appendChild(btn);
    });
  }

  function renderTextToWindow(data) {
    const textBox = document.getElementById('ya-helper-text');
    const subtitle = document.getElementById('ya-helper-subtitle');
    if (!textBox) return;
    const segments = currentSettings.stitchMode === 'lines' ? data.lineSegments : data.joinedSegments;
    if (!segments || !segments.length) { subtitle.textContent = 'Текстовый сегмент на странице не найден'; return; }
    const metaParts = [data.dateStr ? `Дата: ${data.dateStr}` : (data.docYear ? `Год: ${data.docYear}` : ''), `Блоков: ${segments.length}`].filter(Boolean);
    subtitle.textContent = metaParts.join(' • ');
    textBox.innerHTML = '';
    lastDebugLog = [];
    segments.forEach((seg, idx) => {
      const blockDiv = document.createElement('div');
      blockDiv.className = 'yah-stitched-block';
      const blockLogs = [];
      blockDiv.textContent = applyTextTransform(seg, data.docYear, blockLogs);
      if (blockLogs.length) {
        lastDebugLog.push(`Блок ${idx + 1}:`);
        lastDebugLog.push(...blockLogs);
      }
      textBox.appendChild(blockDiv);
    });
  }

  async function refreshContent(force = false) {
    if (!force && location.href === lastLoadedUrl && lastExtractedData) { renderTextToWindow(lastExtractedData); return; }
    lastLoadedUrl = location.href;
    const data = await collectPageData();
    lastExtractedData = data;
    renderTextToWindow(data);
  }

  function showToast(msg) {
    const toast = document.getElementById('ya-helper-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2300);
  }

  async function init() {
    currentSettings = await api.storage.local.get(DEFAULT_SETTINGS);
    createFloatingWindow();
    api.storage.onChanged.addListener((changes) => {
      for (const k in changes) currentSettings[k] = changes[k].newValue;
      applyAppearance();
      if (lastExtractedData) renderTextToWindow(lastExtractedData);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentSettings.theme === 'system') applyAppearance();
    });
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const urlChanged = location.href !== lastLoadedUrl;
        if (urlChanged || !lastExtractedData || !lastExtractedData.joinedSegments.length) refreshContent(true);
      }, 700);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  init();
})();
