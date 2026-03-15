import { exportCSV, exportPNG, shareToTelegram, formatValue, calcCost, formatCost } from './export.js';

// --- Пресеты вероятностей сценариев ---
const PRESETS = {
  optimistic:  { label: '🚀 Оптимист',   weights: [40, 40, 20], hint: '40 / 40 / 20' },
  neutral:     { label: '🟡 Нейтрально', weights: [25, 50, 25], hint: '25 / 50 / 25' },
  pessimistic: { label: '⚠️ Риск',       weights: [15, 35, 50], hint: '15 / 35 / 50' },
};

// --- Состояние приложения ---
const state = {
  screen: 1,
  projectName: '',
  unit: 'days',       // 'days' | 'weeks'
  rate: null,
  rateUnit: 'hour',   // 'hour' | 'day'
  globalPreset: 'neutral',
  tasks: [],
  results: null,
};

let taskIdCounter = 0;
let chart = null;
let worker = null;

// --- Инициализация ---
document.addEventListener('DOMContentLoaded', () => {
  if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
  }
  setupScreen1();
  setupScreen2();
  setupScreen3();
  showScreen(1);
});

// ===========================
// ЭКРАН 1: Настройка проекта
// ===========================
function setupScreen1() {
  const form = document.getElementById('screen1');

  form.querySelectorAll('input[name="rate-unit"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const hint = document.getElementById('rate-hint');
      if (!hint) return;
      hint.textContent = radio.value === 'hour'
        ? 'Если указать — покажем стоимость проекта (1 день = 8 часов)'
        : 'Если указать — покажем стоимость проекта (1 неделя = 5 рабочих дней)';
    });
  });

  form.querySelector('#btn-to-screen2').addEventListener('click', () => {
    const nameInput = form.querySelector('#project-name');
    const name = nameInput.value.trim();
    if (!name) { nameInput.classList.add('error'); nameInput.focus(); return; }
    nameInput.classList.remove('error');

    state.projectName = name;
    state.unit = form.querySelector('input[name="unit"]:checked').value;
    state.rateUnit = form.querySelector('input[name="rate-unit"]:checked').value;
    const rateVal = parseFloat(form.querySelector('#team-rate').value);
    state.rate = isNaN(rateVal) || rateVal <= 0 ? null : rateVal;

    if (state.tasks.length === 0) addTask();
    renderTaskList();
    showScreen(2);
  });
}

// ===========================
// ЭКРАН 2: Задачи
// ===========================
function setupScreen2() {
  // Глобальный пресет
  document.querySelectorAll('#global-presets .preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.globalPreset = btn.dataset.preset;
      // Обновляем все задачи, у которых нет ручного переопределения
      state.tasks.forEach((task) => {
        if (!task.presetOverridden) {
          task.preset = state.globalPreset;
          task.weights = [...PRESETS[state.globalPreset].weights];
        }
      });
      renderGlobalPresets();
      renderTaskList();
    });
  });

  // Добавить задачу
  document.getElementById('btn-add-task').addEventListener('click', () => {
    if (state.tasks.length >= 30) {
      showWarning('⚠️ Много задач — рассмотри декомпозицию по этапам и оценивай каждый этап отдельно.');
    }
    addTask();
    renderTaskList();
  });

  // Импорт файла
  document.getElementById('btn-import-tasks').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });

  document.getElementById('import-file-input').addEventListener('change', handleFileImport);

  // Скачать шаблон
  document.getElementById('btn-download-template').addEventListener('click', (e) => {
    e.preventDefault();
    downloadTemplate();
  });

  document.getElementById('btn-back-1').addEventListener('click', () => showScreen(1));
  document.getElementById('btn-calculate').addEventListener('click', () => {
    if (!validateTasks()) return;
    runSimulation();
  });

  // Кнопки модального окна импорта
  document.getElementById('btn-import-cancel').addEventListener('click', closeImportModal);
  document.getElementById('btn-close-modal').addEventListener('click', closeImportModal);
  document.getElementById('btn-import-confirm').addEventListener('click', importSelectedTasks);
}

function renderGlobalPresets() {
  document.querySelectorAll('#global-presets .preset-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === state.globalPreset);
  });
}

function addTask() {
  taskIdCounter++;
  state.tasks.push({
    id: taskIdCounter,
    name: '',
    optimistic: '',
    realistic: '',
    pessimistic: '',
    preset: state.globalPreset,
    presetOverridden: false,
    weights: [...PRESETS[state.globalPreset].weights],
  });
}

function removeTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  renderTaskList();
}

function renderTaskList() {
  const container = document.getElementById('task-list');
  container.innerHTML = '';

  state.tasks.forEach((task, index) => {
    const card = document.createElement('div');
    card.className = 'task-card';

    const overriddenBadge = task.presetOverridden
      ? `<span class="preset-overridden-badge">✏️ вручную</span>` : '';

    card.innerHTML = `
      <div class="task-header">
        <span class="task-number">Задача #${index + 1}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          ${overriddenBadge}
          ${state.tasks.length > 1 ? `<button class="btn-remove" data-id="${task.id}" title="Удалить">✕</button>` : ''}
        </div>
      </div>

      <div class="field-group">
        <label>Название задачи</label>
        <input type="text" class="task-name"
          placeholder="Например: Разработка API"
          value="${escapeHtml(task.name)}"
          data-id="${task.id}" data-field="name"
        />
      </div>

      <div class="field-group">
        <label>Сколько ${unitLabel()} займёт задача?</label>
        <p class="hint">Введи три оценки — по каждому сценарию развития событий</p>
        <div class="scenarios">
          <div class="scenario">
            <div class="scenario-icon">🟢</div>
            <div class="scenario-label">Оптимистично<br><small>Всё пойдёт идеально</small></div>
            <input type="number" min="0.1" step="0.1" class="scenario-input" placeholder="3"
              value="${task.optimistic}"
              data-id="${task.id}" data-field="optimistic" />
            <span class="unit-suffix">${unitSuffix()}</span>
          </div>
          <div class="scenario">
            <div class="scenario-icon">🟡</div>
            <div class="scenario-label">Реалистично<br><small>Обычный ход событий</small></div>
            <input type="number" min="0.1" step="0.1" class="scenario-input" placeholder="7"
              value="${task.realistic}"
              data-id="${task.id}" data-field="realistic" />
            <span class="unit-suffix">${unitSuffix()}</span>
          </div>
          <div class="scenario">
            <div class="scenario-icon">🔴</div>
            <div class="scenario-label">Пессимистично<br><small>Что-то пойдёт не так</small></div>
            <input type="number" min="0.1" step="0.1" class="scenario-input" placeholder="14"
              value="${task.pessimistic}"
              data-id="${task.id}" data-field="pessimistic" />
            <span class="unit-suffix">${unitSuffix()}</span>
          </div>
        </div>
      </div>

      <div class="field-group">
        <label>Профиль риска задачи</label>
        <p class="hint">Влияет на вероятность каждого сценария</p>
        <div class="preset-buttons task-presets" data-id="${task.id}">
          ${Object.entries(PRESETS).map(([key, p]) => `
            <button class="preset-btn ${task.preset === key && !task.presetOverridden ? 'active' : ''}"
              data-id="${task.id}" data-preset="${key}">
              ${p.label}<br><small class="preset-hint-text">${p.hint}</small>
            </button>
          `).join('')}
        </div>
        <div class="weights-manual-toggle">
          <button class="btn-manual-toggle" data-id="${task.id}">⚙️ задать вручную</button>
        </div>
        <div class="weights-manual hidden" data-id="${task.id}">
          <div class="weights">
            <div class="weight-item">
              <span>🟢</span>
              <input type="number" min="0" max="100" class="weight-input" value="${task.weights[0]}"
                data-id="${task.id}" data-field="w0" />
              <span>%</span>
            </div>
            <div class="weight-sep">+</div>
            <div class="weight-item">
              <span>🟡</span>
              <input type="number" min="0" max="100" class="weight-input" value="${task.weights[1]}"
                data-id="${task.id}" data-field="w1" />
              <span>%</span>
            </div>
            <div class="weight-sep">+</div>
            <div class="weight-item">
              <span>🔴</span>
              <input type="number" min="0" max="100" class="weight-input" value="${task.weights[2]}"
                data-id="${task.id}" data-field="w2" />
              <span>%</span>
            </div>
            <div class="weight-sep">=</div>
            <div class="weight-total" data-id="${task.id}">
              ${task.weights.reduce((a, b) => a + b, 0)}%
            </div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // События — удаление
  container.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeTask(+btn.dataset.id));
  });

  // События — пресеты задачи
  container.querySelectorAll('.task-presets .preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleTaskPresetClick(btn));
  });

  // События — кнопка "задать вручную"
  container.querySelectorAll('.btn-manual-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const manualSection = container.querySelector(`.weights-manual[data-id="${btn.dataset.id}"]`);
      if (manualSection) manualSection.classList.toggle('hidden');
    });
  });

  // События — инпуты
  container.querySelectorAll('input[data-field]').forEach((input) => {
    input.addEventListener('input', handleTaskInput);
  });
}

function handleTaskPresetClick(btn) {
  const task = state.tasks.find((t) => t.id === +btn.dataset.id);
  if (!task) return;
  task.preset = btn.dataset.preset;
  task.weights = [...PRESETS[task.preset].weights];
  task.presetOverridden = (task.preset !== state.globalPreset);
  renderTaskList();
}

function handleTaskInput(e) {
  const { id, field } = e.target.dataset;
  const task = state.tasks.find((t) => t.id === +id);
  if (!task) return;

  if (field === 'name') {
    task.name = e.target.value;
  } else if (['optimistic', 'realistic', 'pessimistic'].includes(field)) {
    task[field] = e.target.value;
    e.target.classList.remove('error');
  } else if (['w0', 'w1', 'w2'].includes(field)) {
    const idx = +field[1];
    task.weights[idx] = parseFloat(e.target.value) || 0;
    task.presetOverridden = true;
    task.preset = '_custom';
    const total = task.weights.reduce((a, b) => a + b, 0);
    const totalEl = document.querySelector(`.weight-total[data-id="${id}"]`);
    if (totalEl) {
      totalEl.textContent = `${Math.round(total)}%`;
      totalEl.classList.toggle('error', Math.round(total) !== 100);
    }
  }
}

// ===========================
// ИМПОРТ ФАЙЛОВ
// ===========================
async function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // сбрасываем для повторного выбора

  try {
    let parsed = [];
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv') {
      const text = await file.text();
      parsed = parseCSV(text);
    } else if (ext === 'xml') {
      const text = await file.text();
      parsed = parseProjectXML(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      parsed = await parseExcel(file);
    } else {
      showWarning('Поддерживаемые форматы: CSV, XLSX, XML (MS Project)');
      return;
    }

    if (!parsed || parsed.length === 0) {
      showWarning('Не удалось распознать задачи в файле. Проверь формат и попробуй шаблон CSV.');
      return;
    }

    // Автоматически рассчитываем оптимист/пессимист если не заданы
    parsed = parsed.map(autoCalcScenarios);
    showImportModal(parsed);

  } catch (err) {
    console.error(err);
    showWarning('Ошибка при чтении файла: ' + err.message);
  }
}

function autoCalcScenarios(task) {
  const r = parseFloat(task.realistic);
  if (isNaN(r) || r <= 0) return task;
  return {
    ...task,
    optimistic: task.optimistic || +(r * 0.7).toFixed(1),
    realistic: r,
    pessimistic: task.pessimistic || +(r * 1.5).toFixed(1),
  };
}

// --- CSV парсер ---
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(/[,;\t]/).map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

  const colIdx = {
    name: findColIdx(headers, ['название', 'name', 'задача', 'task', 'summary', 'заголовок']),
    optimistic: findColIdx(headers, ['оптимист', 'optimistic', 'opt', 'min', 'мин', 'лучший']),
    realistic: findColIdx(headers, ['реалист', 'realistic', 'real', 'duration', 'длительность', 'estimate', 'mid', 'оценка']),
    pessimistic: findColIdx(headers, ['пессимист', 'pessimistic', 'pes', 'max', 'макс', 'худший']),
  };

  if (colIdx.name === -1) return [];

  const tasks = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (!cols.length) continue;
    const name = (cols[colIdx.name] || '').trim().replace(/^["']|["']$/g, '');
    if (!name) continue;

    tasks.push({
      name,
      optimistic: colIdx.optimistic >= 0 ? parseFloat(cols[colIdx.optimistic]) || '' : '',
      realistic:  colIdx.realistic  >= 0 ? parseFloat(cols[colIdx.realistic])  || '' : '',
      pessimistic: colIdx.pessimistic >= 0 ? parseFloat(cols[colIdx.pessimistic]) || '' : '',
    });
  }
  return tasks;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if ((ch === ',' || ch === ';' || ch === '\t') && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function findColIdx(headers, variants) {
  return headers.findIndex((h) => variants.some((v) => h.includes(v)));
}

// --- MS Project XML парсер ---
function parseProjectXML(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Невалидный XML');

  const tasks = [];
  doc.querySelectorAll('Task').forEach((taskEl) => {
    // Пропускаем суммарные задачи
    const isSummary = taskEl.querySelector('Summary')?.textContent === '1';
    const isNull    = taskEl.querySelector('Null')?.textContent === '1';
    if (isSummary || isNull) return;

    const name = taskEl.querySelector('Name')?.textContent?.trim();
    if (!name || name === 'Project Summary' || name === 'New Task') return;

    const durationStr = taskEl.querySelector('Duration')?.textContent;
    if (!durationStr) return;

    const days = parseMSPDuration(durationStr);
    if (days <= 0) return;

    // Переводим в текущую единицу
    const value = state.unit === 'weeks' ? +(days / 5).toFixed(1) : +days.toFixed(1);
    tasks.push({ name, realistic: value, optimistic: '', pessimistic: '' });
  });
  return tasks;
}

function parseMSPDuration(str) {
  // ISO 8601: PT8H0M0S или P1DT0H0M0S
  const m = str.match(/P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?/);
  if (!m) return 0;
  const d = parseFloat(m[1] || 0);
  const h = parseFloat(m[2] || 0);
  const min = parseFloat(m[3] || 0);
  return d + h / 8 + min / 480;
}

// --- Excel парсер (SheetJS) ---
async function parseExcel(file) {
  if (!window.XLSX) {
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  }
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const csv = window.XLSX.utils.sheet_to_csv(ws);
  return parseCSV(csv);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// --- Скачать шаблон CSV ---
function downloadTemplate() {
  const unit = state.unit === 'days' ? 'дней' : 'недель';
  let csv = '\uFEFF';
  csv += `Название,Оптимист (${unit}),Реалист (${unit}),Пессимист (${unit})\n`;
  csv += `Подготовка инфраструктуры,2,5,10\n`;
  csv += `Разработка API,3,7,14\n`;
  csv += `Тестирование,1,3,6\n`;
  csv += `Деплой,0.5,1,2\n`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'monte-carlo-template.csv'; a.click();
  URL.revokeObjectURL(url);
}

// --- Модальное окно предпросмотра импорта ---
function showImportModal(parsedTasks) {
  const list = document.getElementById('import-task-preview');
  list.innerHTML = '';

  parsedTasks.forEach((task, i) => {
    const row = document.createElement('div');
    row.className = 'import-task-row';
    const hasAllValues = task.optimistic && task.realistic && task.pessimistic;
    row.innerHTML = `
      <label class="import-task-label">
        <input type="checkbox" class="import-checkbox" data-idx="${i}" ${hasAllValues ? 'checked' : ''} />
        <span class="import-task-name">${escapeHtml(task.name)}</span>
        <span class="import-task-values">
          🟢 ${task.optimistic || '?'} / 🟡 ${task.realistic || '?'} / 🔴 ${task.pessimistic || '?'}
          <span class="import-unit">${unitSuffix()}</span>
        </span>
      </label>
    `;
    list.appendChild(row);
  });

  // Сохраняем данные для подтверждения
  list.dataset.tasks = JSON.stringify(parsedTasks);

  // Обновляем счётчик
  document.getElementById('import-selected-count').textContent =
    parsedTasks.filter((_, i) => true).length;

  // Пересчёт счётчика при изменении чекбоксов
  list.querySelectorAll('.import-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const selected = list.querySelectorAll('.import-checkbox:checked').length;
      document.getElementById('import-selected-count').textContent = selected;
    });
  });

  document.getElementById('import-modal').classList.remove('hidden');
}

function closeImportModal() {
  document.getElementById('import-modal').classList.add('hidden');
}

function importSelectedTasks() {
  const list = document.getElementById('import-task-preview');
  const allTasks = JSON.parse(list.dataset.tasks || '[]');
  const checkboxes = list.querySelectorAll('.import-checkbox:checked');

  checkboxes.forEach((cb) => {
    const task = allTasks[+cb.dataset.idx];
    if (!task) return;
    taskIdCounter++;
    state.tasks.push({
      id: taskIdCounter,
      name: task.name,
      optimistic: String(task.optimistic || ''),
      realistic:  String(task.realistic  || ''),
      pessimistic: String(task.pessimistic || ''),
      preset: state.globalPreset,
      presetOverridden: false,
      weights: [...PRESETS[state.globalPreset].weights],
    });
  });

  closeImportModal();
  renderTaskList();
}

// ===========================
// ВАЛИДАЦИЯ
// ===========================
function validateTasks() {
  if (state.tasks.length === 0) {
    showWarning('Добавь хотя бы одну задачу.');
    return false;
  }
  for (const task of state.tasks) {
    const opt  = parseFloat(task.optimistic);
    const real = parseFloat(task.realistic);
    const pes  = parseFloat(task.pessimistic);

    if (isNaN(opt) || isNaN(real) || isNaN(pes)) {
      showWarning('Заполни все три сценария для каждой задачи.');
      return false;
    }
    if (!(opt <= real && real <= pes)) {
      showWarning(`Задача "${task.name || '?'}": Оптимист ≤ Реалист ≤ Пессимист`);
      return false;
    }
    const weightSum = Math.round(task.weights.reduce((a, b) => a + b, 0));
    if (weightSum !== 100) {
      showWarning(`Задача "${task.name || '?'}": сумма весов = ${weightSum}% (нужно 100%)`);
      return false;
    }
  }
  return true;
}

// ===========================
// СИМУЛЯЦИЯ
// ===========================
function runSimulation() {
  const btn = document.getElementById('btn-calculate');
  btn.disabled = true;
  btn.textContent = '⏳ Считаем...';

  const tasksData = state.tasks.map((t) => ({
    optimistic:  parseFloat(t.optimistic),
    realistic:   parseFloat(t.realistic),
    pessimistic: parseFloat(t.pessimistic),
    weights: t.weights,
  }));

  if (worker) worker.terminate();
  worker = new Worker('./worker.js');
  worker.postMessage({ tasks: tasksData, iterations: 10000 });

  worker.onmessage = (e) => {
    state.results = e.data;
    worker.terminate();
    worker = null;
    btn.disabled = false;
    btn.textContent = '🎲 Рассчитать';
    renderResults();
    showScreen(3);
  };

  worker.onerror = (err) => {
    console.error(err);
    btn.disabled = false;
    btn.textContent = '🎲 Рассчитать';
    showWarning('Ошибка при расчёте. Попробуй снова.');
  };
}

// ===========================
// ЭКРАН 3: Результаты
// ===========================
function setupScreen3() {
  document.getElementById('btn-back-2').addEventListener('click', () => showScreen(2));
  document.getElementById('btn-recalculate').addEventListener('click', () => showScreen(2));
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    exportCSV(state.projectName, state.unit, state.rate, state.rateUnit, state.results.percentiles);
  });
  document.getElementById('btn-export-png').addEventListener('click', () => {
    exportPNG('results-content');
  });
  document.getElementById('btn-share-tg').addEventListener('click', () => {
    shareToTelegram(state.projectName, state.unit, state.rate, state.rateUnit, state.results.percentiles);
  });
  document.getElementById('btn-toggle-table').addEventListener('click', () => {
    const table = document.getElementById('full-table');
    const btn = document.getElementById('btn-toggle-table');
    const isHidden = table.classList.toggle('hidden');
    btn.textContent = isHidden ? '▾ Полная таблица перцентилей' : '▴ Скрыть таблицу';
  });
}

function renderResults() {
  const { percentiles, cdfPoints } = state.results;
  const hasRate = state.rate && state.rate > 0;
  const unitStr = state.unit === 'days' ? 'дн.' : 'нед.';

  document.getElementById('results-title').textContent = state.projectName;

  const rateLabel = state.rateUnit === 'hour' ? `${state.rate} ₽/час` : `${state.rate} ₽/день`;
  const cards = [
    { p: 50, icon: '🎯', label: 'Базовый',   desc: 'Каждый второй проект завершается раньше этой даты' },
    { p: 80, icon: '📋', label: 'Для плана', desc: 'В 8 случаях из 10 уложитесь в этот срок' },
    { p: 95, icon: '🛡️', label: 'С запасом', desc: 'Практически наверняка. Называйте руководству' },
  ];

  cards.forEach(({ p, icon, label, desc }) => {
    const pData = percentiles.find((x) => x.p === p);
    const val = formatValue(pData.value, state.unit);
    const card = document.getElementById(`card-p${p}`);

    card.querySelector('.card-icon').textContent = icon;
    card.querySelector('.card-label').textContent = label;
    card.querySelector('.card-value').textContent = `${val} ${unitStr}`;
    card.querySelector('.card-prob').textContent = `С вероятностью ${p}% проект завершится за этот срок`;
    card.querySelector('.card-desc').textContent = desc;

    if (hasRate) {
      const cost = calcCost(pData.value, state.rateUnit, state.rate);
      card.querySelector('.card-cost').textContent = `≈ ${formatCost(cost)} ₽  (ставка: ${rateLabel})`;
      card.querySelector('.card-cost').classList.remove('hidden');
    } else {
      card.querySelector('.card-cost').classList.add('hidden');
    }
  });

  const tbody = document.querySelector('#full-table tbody');
  tbody.innerHTML = '';
  percentiles.forEach(({ p, value }) => {
    const val = formatValue(value, state.unit);
    const tr = document.createElement('tr');
    if (hasRate) {
      const cost = calcCost(value, state.rateUnit, state.rate);
      tr.innerHTML = `<td>${p}%</td><td>${val} ${unitStr}</td><td>${formatCost(cost)} ₽</td>`;
    } else {
      tr.innerHTML = `<td>${p}%</td><td>${val} ${unitStr}</td>`;
    }
    tbody.appendChild(tr);
  });

  const thead = document.querySelector('#full-table thead tr');
  thead.innerHTML = hasRate
    ? '<th>Вероятность</th><th>Срок</th><th>Стоимость</th>'
    : '<th>Вероятность</th><th>Срок</th>';

  renderChart(cdfPoints, unitStr);
}

function renderChart(cdfPoints, unitStr) {
  const ctx = document.getElementById('cdf-chart').getContext('2d');
  if (chart) chart.destroy();

  const labels = cdfPoints.map((p) =>
    state.unit === 'days' ? Math.round(p.x) : (p.x / 5).toFixed(1)
  );
  const data = cdfPoints.map((p) => p.y);

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Вероятность завершения',
        data,
        borderColor: '#D4956A',
        backgroundColor: 'rgba(212, 149, 106, 0.15)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].label} ${unitStr}`,
            label: (item) => `Вероятность: ${item.raw}%`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: `Срок (${unitStr})`, color: '#8B7A9A', font: { size: 12 } },
          ticks: { maxTicksLimit: 10, color: '#A090B0' },
          grid: { color: 'rgba(107, 90, 122, 0.1)' },
        },
        y: {
          title: { display: true, text: 'Вероятность (%)', color: '#8B7A9A', font: { size: 12 } },
          min: 0, max: 100,
          ticks: { callback: (v) => v + '%', color: '#A090B0' },
          grid: { color: 'rgba(107, 90, 122, 0.1)' },
        },
      },
    },
  });
}

// ===========================
// УТИЛИТЫ
// ===========================
function showScreen(n) {
  [1, 2, 3].forEach((i) => {
    document.getElementById(`screen${i}`).classList.toggle('hidden', i !== n);
  });
  [1, 2, 3].forEach((i) => {
    const step = document.getElementById(`step${i}`);
    if (!step) return;
    step.classList.remove('active', 'done');
    if (i < n) step.classList.add('done');
    else if (i === n) step.classList.add('active');
  });
  if (n === 2) renderGlobalPresets();
  state.screen = n;
  window.scrollTo(0, 0);
}

function unitLabel() { return state.unit === 'days' ? 'дней' : 'недель'; }
function unitSuffix() { return state.unit === 'days' ? 'дн.' : 'нед.'; }

function showWarning(msg) {
  const el = document.getElementById('warning-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
