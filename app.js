import { exportCSV, exportPNG, shareToTelegram, formatValue, calcCost, formatCost } from './export.js';

// --- Состояние приложения ---
const state = {
  screen: 1,         // текущий экран 1|2|3
  projectName: '',
  unit: 'days',      // 'days' | 'weeks'
  rate: null,        // ₽/час или null
  tasks: [],         // массив задач
  results: null,     // { percentiles, cdfPoints }
};

let taskIdCounter = 0;
let chart = null;
let worker = null;

// --- Инициализация ---
document.addEventListener('DOMContentLoaded', () => {
  // Telegram Web App SDK
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

  form.querySelector('#btn-to-screen2').addEventListener('click', () => {
    const nameInput = form.querySelector('#project-name');
    const name = nameInput.value.trim();

    if (!name) {
      nameInput.classList.add('error');
      nameInput.focus();
      return;
    }
    nameInput.classList.remove('error');

    state.projectName = name;
    state.unit = form.querySelector('input[name="unit"]:checked').value;
    const rateVal = parseFloat(form.querySelector('#team-rate').value);
    state.rate = isNaN(rateVal) || rateVal <= 0 ? null : rateVal;

    // Добавляем первую задачу если список пустой
    if (state.tasks.length === 0) addTask();

    renderTaskList();
    showScreen(2);
  });
}

// ===========================
// ЭКРАН 2: Задачи
// ===========================
function setupScreen2() {
  document.getElementById('btn-add-task').addEventListener('click', () => {
    if (state.tasks.length >= 30) {
      showWarning('⚠️ Много задач — рассмотри декомпозицию по этапам и оценивай каждый этап отдельно.');
    }
    addTask();
    renderTaskList();
  });

  document.getElementById('btn-back-1').addEventListener('click', () => showScreen(1));

  document.getElementById('btn-calculate').addEventListener('click', () => {
    if (!validateTasks()) return;
    runSimulation();
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
    weights: [25, 50, 25],
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
    card.innerHTML = `
      <div class="task-header">
        <span class="task-number">Задача #${index + 1}</span>
        ${state.tasks.length > 1 ? `<button class="btn-remove" data-id="${task.id}" title="Удалить">✕</button>` : ''}
      </div>

      <div class="field-group">
        <label>Название задачи</label>
        <input
          type="text"
          class="task-name"
          placeholder="Например: Разработка API"
          value="${escapeHtml(task.name)}"
          data-id="${task.id}"
          data-field="name"
        />
      </div>

      <div class="field-group">
        <label>Сколько ${unitLabel()} займёт задача?</label>
        <p class="hint">Введи три оценки — по каждому сценарию развития событий</p>
        <div class="scenarios">
          <div class="scenario">
            <div class="scenario-icon">🟢</div>
            <div class="scenario-label">Оптимистично<br><small>Всё пойдёт идеально</small></div>
            <input type="number" min="0.1" step="0.1"
              class="scenario-input" placeholder="3"
              value="${task.optimistic}"
              data-id="${task.id}" data-field="optimistic"
            />
            <span class="unit-suffix">${unitSuffix()}</span>
          </div>
          <div class="scenario">
            <div class="scenario-icon">🟡</div>
            <div class="scenario-label">Реалистично<br><small>Обычный ход событий</small></div>
            <input type="number" min="0.1" step="0.1"
              class="scenario-input" placeholder="7"
              value="${task.realistic}"
              data-id="${task.id}" data-field="realistic"
            />
            <span class="unit-suffix">${unitSuffix()}</span>
          </div>
          <div class="scenario">
            <div class="scenario-icon">🔴</div>
            <div class="scenario-label">Пессимистично<br><small>Что-то пойдёт не так</small></div>
            <input type="number" min="0.1" step="0.1"
              class="scenario-input" placeholder="14"
              value="${task.pessimistic}"
              data-id="${task.id}" data-field="pessimistic"
            />
            <span class="unit-suffix">${unitSuffix()}</span>
          </div>
        </div>
      </div>

      <div class="field-group">
        <label>С какой вероятностью выпадет каждый сценарий?</label>
        <p class="hint">По умолчанию 25/50/25. Увеличь пессимизм если проект рискованный.</p>
        <div class="weights">
          <div class="weight-item">
            <span>🟢</span>
            <input type="number" min="0" max="100"
              class="weight-input" value="${task.weights[0]}"
              data-id="${task.id}" data-field="w0"
            />
            <span>%</span>
          </div>
          <div class="weight-sep">+</div>
          <div class="weight-item">
            <span>🟡</span>
            <input type="number" min="0" max="100"
              class="weight-input" value="${task.weights[1]}"
              data-id="${task.id}" data-field="w1"
            />
            <span>%</span>
          </div>
          <div class="weight-sep">+</div>
          <div class="weight-item">
            <span>🔴</span>
            <input type="number" min="0" max="100"
              class="weight-input" value="${task.weights[2]}"
              data-id="${task.id}" data-field="w2"
            />
            <span>%</span>
          </div>
          <div class="weight-sep">=</div>
          <div class="weight-total" data-id="${task.id}">
            ${task.weights[0] + task.weights[1] + task.weights[2]}%
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // Навешиваем события
  container.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeTask(+btn.dataset.id));
  });

  container.querySelectorAll('input[data-field]').forEach((input) => {
    input.addEventListener('input', handleTaskInput);
  });
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
    // Обновляем отображение суммы
    const total = task.weights.reduce((a, b) => a + b, 0);
    const totalEl = document.querySelector(`.weight-total[data-id="${id}"]`);
    if (totalEl) {
      totalEl.textContent = `${Math.round(total)}%`;
      totalEl.classList.toggle('error', Math.round(total) !== 100);
    }
  }
}

function validateTasks() {
  let valid = true;

  if (state.tasks.length === 0) {
    showWarning('Добавь хотя бы одну задачу.');
    return false;
  }

  for (const task of state.tasks) {
    const opt = parseFloat(task.optimistic);
    const real = parseFloat(task.realistic);
    const pes = parseFloat(task.pessimistic);

    if (isNaN(opt) || isNaN(real) || isNaN(pes)) {
      showWarning('Заполни все три сценария для каждой задачи.');
      return false;
    }

    if (!(opt <= real && real <= pes)) {
      showWarning(`Задача "${task.name || '?'}": Оптимистичная ≤ Реалистичная ≤ Пессимистичная`);
      return false;
    }

    const weightSum = Math.round(task.weights.reduce((a, b) => a + b, 0));
    if (weightSum !== 100) {
      showWarning(`Задача "${task.name || '?'}": сумма весов должна быть 100% (сейчас ${weightSum}%)`);
      return false;
    }
  }

  return valid;
}

// ===========================
// СИМУЛЯЦИЯ
// ===========================
function runSimulation() {
  const btn = document.getElementById('btn-calculate');
  btn.disabled = true;
  btn.textContent = '⏳ Считаем...';

  const tasksData = state.tasks.map((t) => ({
    optimistic: parseFloat(t.optimistic),
    realistic: parseFloat(t.realistic),
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
    exportCSV(state.projectName, state.unit, state.rate, state.results.percentiles);
  });
  document.getElementById('btn-export-png').addEventListener('click', () => {
    exportPNG('results-content');
  });
  document.getElementById('btn-share-tg').addEventListener('click', () => {
    shareToTelegram(state.projectName, state.unit, state.rate, state.results.percentiles);
  });

  // Раскрытие полной таблицы
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

  // Заголовок
  document.getElementById('results-title').textContent = state.projectName;

  // Три карточки P50/P80/P95
  const cards = [
    { p: 50, icon: '🎯', label: 'Базовый', desc: 'Каждый второй проект завершается раньше этой даты' },
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
      const cost = calcCost(pData.value, state.unit, state.rate);
      card.querySelector('.card-cost').textContent = `≈ ${formatCost(cost)} ₽`;
      card.querySelector('.card-cost').classList.remove('hidden');
    } else {
      card.querySelector('.card-cost').classList.add('hidden');
    }
  });

  // Полная таблица
  const tbody = document.querySelector('#full-table tbody');
  tbody.innerHTML = '';
  percentiles.forEach(({ p, value }) => {
    const val = formatValue(value, state.unit);
    const tr = document.createElement('tr');
    if (hasRate) {
      const cost = calcCost(value, state.unit, state.rate);
      tr.innerHTML = `<td>${p}%</td><td>${val} ${unitStr}</td><td>${formatCost(cost)} ₽</td>`;
    } else {
      tr.innerHTML = `<td>${p}%</td><td>${val} ${unitStr}</td>`;
    }
    tbody.appendChild(tr);
  });

  // Заголовок таблицы
  const thead = document.querySelector('#full-table thead tr');
  thead.innerHTML = hasRate
    ? '<th>Вероятность</th><th>Срок</th><th>Стоимость</th>'
    : '<th>Вероятность</th><th>Срок</th>';

  // CDF График
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
      datasets: [
        {
          label: `Вероятность завершения`,
          data,
          borderColor: '#D4956A',
          backgroundColor: 'rgba(212, 149, 106, 0.15)',
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2.5,
        },
      ],
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
          title: {
            display: true,
            text: `Срок (${unitStr})`,
            color: '#8B7A9A',
            font: { size: 12 },
          },
          ticks: { maxTicksLimit: 10, color: '#A090B0' },
          grid: { color: 'rgba(107, 90, 122, 0.1)' },
        },
        y: {
          title: {
            display: true,
            text: 'Вероятность (%)',
            color: '#8B7A9A',
            font: { size: 12 },
          },
          min: 0,
          max: 100,
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
  // Обновляем прогресс-бар
  [1, 2, 3].forEach((i) => {
    const step = document.getElementById(`step${i}`);
    if (!step) return;
    step.classList.remove('active', 'done');
    if (i < n) step.classList.add('done');
    else if (i === n) step.classList.add('active');
  });
  state.screen = n;
  window.scrollTo(0, 0);
}

function unitLabel() {
  return state.unit === 'days' ? 'дней' : 'недель';
}

function unitSuffix() {
  return state.unit === 'days' ? 'дн.' : 'нед.';
}

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
