(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const NamesRu = window.NamesRu || { M: [], F: [] };
  const MALE_NAMES = new Set(NamesRu.M || []);
  const FEMALE_NAMES = new Set(NamesRu.F || []);

  const DEFAULT_SETTINGS = {
    textMode: 'original',
    stitchMode: 'joined',
    substitutePatronymic: true,
    substituteBirthYear: false,
    nameDictionary: 'Авдотья=Евдокия\nАграфена=Агриппина\nЕгор=Георгий\nАксинья=Ксения\nИван=Иоанн\nФедор=Феодор\nСемен=Симеон\nСтепан=Стефан',
    borderWidth: 2,
    buttonsPosition: 'bottom',
    enabledButtons: [
      'copy_sel_clip',
      'copy_sel_new_file',
      'copy_sel_open_file',
      'copy_all_clip',
      'copy_all_new_file',
      'copy_all_open_file'
    ],
    theme: 'system',
    textColor: '#1f2328',
    selectionBgColor: '#ffd33d',
    selectionTextColor: '#000000'
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let openFileHandle = null;
  let lastLoadedUrl = '';
  let lastExtractedData = null;

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
    } catch (e) { /* fallback to fetch */ }

    try {
      const r = await fetch(location.href, { credentials: 'include' });
      const html = await r.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) {
        const node = parseNode(JSON.parse(m[1]));
        if (node) return node;
      }
    } catch (e) { /* unavailable */ }

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
      if (last && Math.abs(cy - last.cy) <= tol) {
        last.items.push(b);
      } else {
        rows.push({ cy, items: [b] });
      }
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
      const joinedSegments = (nextNode.joinedTextBlocks || [])
        .map((b) => cleanText(typeof b === 'string' ? b : (b.text || '')))
        .filter(Boolean);
      const lineSegments = (nextNode.textBlocks || [])
        .map((b) => cleanText(typeof b === 'string' ? b : (b.text || '')))
        .filter(Boolean);

      return {
        source: '__NEXT_DATA__',
        crumbs: nextNode.crumbs.join(' / '),
        dateStr,
        docYear,
        joinedSegments: joinedSegments.length ? joinedSegments : lineSegments,
        lineSegments: lineSegments.length ? lineSegments : joinedSegments
      };
    }

    const domEl = findAutoTextContainer();
    const domLines = stitchDomContainer(domEl);
    return {
      source: 'DOM-сегмент',
      crumbs: '',
      dateStr,
      docYear,
      joinedSegments: domLines,
      lineSegments: domLines
    };
  }

  function normOldOrthography(word) {
    return word
      .toLowerCase()
      .replace(/ѣ/g, 'е')
      .replace(/і/g, 'и')
      .replace(/ѳ/g, 'ф')
      .replace(/ѯ/g, 'кс')
      .replace(/ъ$/g, '');
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

  function buildPatronymic(fatherGenitive, isFemale) {
    const raw = fatherGenitive.trim();
    const norm = normOldOrthography(raw);
    if (!norm) return '';

    if (norm.endsWith('ия') || norm.endsWith('ья')) {
      const stem = raw.slice(0, -2);
      return isFemale ? `${stem}ьевна` : `${stem}ьевич`;
    }
    if (norm.endsWith('ея') || norm.endsWith('ая')) {
      const stem = raw.slice(0, -1);
      return isFemale ? `${stem}вна` : `${stem}вич`;
    }
    if (norm.endsWith('ы') || norm.endsWith('и')) {
      const stem = raw.slice(0, -1);
      return isFemale ? `${stem}инична` : `${stem}ич`;
    }
    if (norm.endsWith('а')) {
      const stem = raw.slice(0, -1);
      return isFemale ? `${stem}овна` : `${stem}ович`;
    }
    return '';
  }

  function applyTextTransform(segment, docYear) {
    if (!segment || currentSettings.textMode === 'original') {
      return segment;
    }

    let text = segment;
    const dictMap = buildDictionaryMap(currentSettings.nameDictionary);

    text = text.replace(/[А-ЯЁа-яёѣіѳѯ]+/g, (token) => {
      const key = normOldOrthography(token);
      if (dictMap.has(key)) {
        const repl = dictMap.get(key);
        const isCap = token[0] === token[0].toUpperCase();
        return isCap ? repl.charAt(0).toUpperCase() + repl.slice(1) : repl.toLowerCase();
      }
      return token;
    });

    if (currentSettings.textMode === 'substitute') {
      if (currentSettings.substitutePatronymic) {
        text = text.replace(
          /\b([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+(?:ова|ева|ина|ына))\s+(сын|дочь)\b/gi,
          (full, firstName, fatherPoss, rel) => {
            const fnNorm = normOldOrthography(firstName);
            const isFemale = FEMALE_NAMES.has(fnNorm) || rel.toLowerCase() === 'дочь';
            const base = fatherPoss.slice(0, -1);
            const patr = isFemale ? `${base}на` : `${base}ич`;
            return `${firstName} ${patr} (${fatherPoss} ${rel})`;
          }
        );

        text = text.replace(
          /\b(сын|дочь)\s+([А-ЯЁ][а-яё]+)\b/gi,
          (full, rel, fatherGen) => {
            const isFemale = rel.toLowerCase() === 'дочь';
            const patr = buildPatronymic(fatherGen, isFemale);
            return patr ? `${full} [${patr}]` : full;
          }
        );
      }

      if (currentSettings.substituteBirthYear && docYear) {
        text = text.replace(/\b(\d{1,3})\s*(?:лѣтъ|лет|года|год)\b/gi, (full, ageStr) => {
          const age = parseInt(ageStr, 10);
          if (age > 0 && age <= 110) {
            return `${full} [~${docYear - age} г.р.]`;
          }
          return full;
        });
      }
    }

    return text;
  }

  function getExportText(scope) {
    const textBox = document.getElementById('ya-helper-text');
    if (!textBox) return null;

    if (scope === 'selection') {
      const sel = window.getSelection();
      const selectedStr = sel ? sel.toString() : '';
      if (!selectedStr.trim()) {
        showToast('Выделите фрагмент текста в окне помощника');
        return null;
      }
      return selectedStr;
    }

    return textBox.innerText.trim();
  }

  async function handleExport(scope, target) {
    const content = getExportText(scope);
    if (!content) return;

    if (target === 'clipboard') {
      try {
        await navigator.clipboard.writeText(content);
        showToast(scope === 'selection' ? 'Выделение скопировано в буфер' : 'Весь текст скопирован в буфер');
      } catch (e) {
        showToast('Ошибка доступа к буферу обмена');
      }
      return;
    }

    if (target === 'new_file') {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.download = `yandex-archive-${stamp}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Сохранено в новый TXT файл');
      return;
    }

    if (target === 'open_file') {
      if (typeof window.showOpenFilePicker === 'function') {
        try {
          if (!openFileHandle) {
            [openFileHandle] = await window.showOpenFilePicker({
              multiple: false,
              types: [{ description: 'Текстовый файл', accept: { 'text/plain': ['.txt'] } }]
            });
          }
          const file = await openFileHandle.getFile();
          const prevText = await file.text();
          const writable = await openFileHandle.createWritable();
          const prefix = prevText && !prevText.endsWith('\n') ? '\n\n' : (prevText ? '\n' : '');
          await writable.write(prevText + prefix + content + '\n');
          await writable.close();
          showToast(`Дописано в файл: ${openFileHandle.name}`);
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            openFileHandle = null;
            showToast('Не удалось записать в открытый файл');
          }
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

    document.getElementById('yah-refresh-btn').addEventListener('click', () => refreshContent(true));
    document.getElementById('yah-file-reset-btn').addEventListener('click', () => {
      openFileHandle = null;
      showToast('Выбор открытого TXT файла сброшен');
    });
    document.getElementById('yah-options-btn').addEventListener('click', () => {
      if (api.runtime && api.runtime.openOptionsPage) {
        api.runtime.openOptionsPage();
      }
    });

    let collapsed = false;
    let savedHeight = '540px';
    document.getElementById('yah-toggle-btn').addEventListener('click', () => {
      collapsed = !collapsed;
      const body = document.getElementById('ya-helper-body');
      if (collapsed) {
        savedHeight = win.style.height || `${win.offsetHeight}px`;
        body.style.display = 'none';
        win.style.height = 'auto';
        win.style.resize = 'none';
      } else {
        body.style.display = 'flex';
        win.style.height = savedHeight;
        win.style.resize = 'both';
      }
    });

    applyAppearance();
    refreshContent(true);
  }

  function initDrag(win, header) {
    let dragging = false;
    let startX = 0;
    let startY = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = win.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      win.style.right = 'auto';
      win.style.bottom = 'auto';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const maxLeft = Math.max(0, window.innerWidth - 120);
      const maxTop = Math.max(0, window.innerHeight - 40);
      const nextLeft = Math.min(maxLeft, Math.max(0, e.clientX - startX));
      const nextTop = Math.min(maxTop, Math.max(0, e.clientY - startY));
      win.style.left = `${nextLeft}px`;
      win.style.top = `${nextTop}px`;
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  function applyAppearance() {
    const win = document.getElementById('ya-helper-window');
    if (!win) return;

    let theme = currentSettings.theme;
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    win.setAttribute('data-theme', theme);

    win.style.setProperty('--yah-border-width', `${currentSettings.borderWidth}px`);
    win.style.setProperty('--yah-text-color', currentSettings.textColor);
    win.style.setProperty('--yah-sel-bg', currentSettings.selectionBgColor);
    win.style.setProperty('--yah-sel-color', currentSettings.selectionTextColor);

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

    if (!segments || !segments.length) {
      subtitle.textContent = 'Текстовый сегмент на странице не найден';
      return;
    }

    const modeLabels = {
      original: 'Оригинал',
      replace: 'Замена имён',
      substitute: 'Подстановка'
    };
    const metaParts = [
      modeLabels[currentSettings.textMode] || 'Оригинал',
      data.dateStr ? `Дата: ${data.dateStr}` : (data.docYear ? `Год: ${data.docYear}` : ''),
      `Блоков: ${segments.length}`
    ].filter(Boolean);
    subtitle.textContent = metaParts.join(' • ');

    textBox.innerHTML = '';
    segments.forEach((seg) => {
      const blockDiv = document.createElement('div');
      blockDiv.className = 'yah-stitched-block';
      blockDiv.textContent = applyTextTransform(seg, data.docYear);
      textBox.appendChild(blockDiv);
    });
  }

  async function refreshContent(force = false) {
    if (!force && location.href === lastLoadedUrl && lastExtractedData) {
      renderTextToWindow(lastExtractedData);
      return;
    }
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
      for (const k in changes) {
        currentSettings[k] = changes[k].newValue;
      }
      applyAppearance();
      if (lastExtractedData) {
        renderTextToWindow(lastExtractedData);
      }
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentSettings.theme === 'system') applyAppearance();
    });

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const urlChanged = location.href !== lastLoadedUrl;
        if (urlChanged || !lastExtractedData || !lastExtractedData.joinedSegments.length) {
          refreshContent(true);
        }
      }, 700);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
