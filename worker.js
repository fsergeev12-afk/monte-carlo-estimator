// Monte Carlo Simulation Web Worker — CPM mode
// Поддерживает два режима:
//   1. Без зависимостей (predecessors пустые) → простая сумма (старое поведение)
//   2. С зависимостями → CPM forward pass с типами FS / FF / SS / SF и лагами

self.onmessage = function (e) {
  const { tasks, iterations = 10000 } = e.data;

  // Определяем режим: есть ли хоть одна зависимость?
  const hasDeps = tasks.some((t) => t.predecessors && t.predecessors.length > 0);

  // Строим карту задач по id (нужна для CPM)
  const taskMap = {};
  tasks.forEach((t) => { taskMap[t.id] = t; });

  // Топологическая сортировка (вычисляется один раз, вне цикла)
  const sorted = hasDeps ? topologicalSort(tasks, taskMap) : tasks;

  const results = new Float64Array(iterations);

  for (let i = 0; i < iterations; i++) {
    results[i] = hasDeps
      ? simulateCPM(sorted, taskMap)
      : simulateSum(tasks);
  }

  // Сортировка для CDF
  results.sort();

  // Перцентили
  const percentiles = [50, 75, 80, 90, 95].map((p) => ({
    p,
    value: results[Math.floor((p / 100) * iterations)],
  }));

  // CDF (100 точек)
  const cdfPoints = [];
  for (let i = 0; i <= 100; i++) {
    const idx = Math.min(Math.floor((i / 100) * iterations), iterations - 1);
    cdfPoints.push({ x: results[idx], y: i });
  }

  self.postMessage({ percentiles, cdfPoints, mode: hasDeps ? 'cpm' : 'sum' });
};

// ─────────────────────────────────────────
// Режим 1: простая сумма (ручной ввод задач)
// ─────────────────────────────────────────
function simulateSum(tasks) {
  let total = 0;
  for (const task of tasks) {
    total += sampleDuration(task);
  }
  return total;
}

// ─────────────────────────────────────────
// Режим 2: CPM forward pass
// ─────────────────────────────────────────
function simulateCPM(sortedTasks, taskMap) {
  const earlyStart  = {};   // ES[id]
  const earlyFinish = {};   // EF[id]

  for (const task of sortedTasks) {
    const dur = sampleDuration(task);
    let es = 0;

    for (const pred of (task.predecessors || [])) {
      if (!(pred.id in taskMap)) continue; // ссылка на задачу вне импорта — пропускаем

      const lag     = pred.lag || 0;
      const predES  = earlyStart[pred.id]  ?? 0;
      const predEF  = earlyFinish[pred.id] ?? 0;
      const type    = (pred.type || 'FS').toUpperCase();

      let constraint;
      switch (type) {
        case 'FS': constraint = predEF + lag;            break; // B начинается после окончания A
        case 'SS': constraint = predES + lag;            break; // B начинается вместе с A
        case 'FF': constraint = predEF + lag - dur;      break; // B заканчивается вместе с A
        case 'SF': constraint = predES + lag - dur;      break; // редкий тип
        default:   constraint = predEF + lag;
      }

      if (constraint > es) es = constraint;
    }

    earlyStart[task.id]  = es < 0 ? 0 : es;
    earlyFinish[task.id] = earlyStart[task.id] + dur;
  }

  // Длительность проекта = самое позднее окончание
  let projectDuration = 0;
  for (const id in earlyFinish) {
    if (earlyFinish[id] > projectDuration) projectDuration = earlyFinish[id];
  }
  return projectDuration;
}

// ─────────────────────────────────────────
// Топологическая сортировка (DFS)
// Возвращает задачи в порядке: предшественники раньше последователей
// ─────────────────────────────────────────
function topologicalSort(tasks, taskMap) {
  const visited = new Set();
  const inStack = new Set(); // для обнаружения циклов
  const result  = [];

  function visit(task) {
    if (inStack.has(task.id)) return; // цикл — пропускаем
    if (visited.has(task.id)) return;

    inStack.add(task.id);

    for (const pred of (task.predecessors || [])) {
      if (taskMap[pred.id]) visit(taskMap[pred.id]);
    }

    inStack.delete(task.id);
    visited.add(task.id);
    result.push(task);
  }

  tasks.forEach((t) => visit(t));
  return result;
}

// ─────────────────────────────────────────
// Семплирование длительности задачи
// ─────────────────────────────────────────
function sampleDuration(task) {
  const { optimistic, realistic, pessimistic, weights } = task;
  const [wOpt, wReal, wPes] = weights;
  const rand = Math.random() * (wOpt + wReal + wPes);

  let scenario;
  if (rand < wOpt) {
    scenario = optimistic;
  } else if (rand < wOpt + wReal) {
    scenario = realistic;
  } else {
    scenario = pessimistic;
  }

  // ±10% разброс внутри выбранного сценария
  const spread = scenario * 0.1;
  return Math.max(0, scenario + (Math.random() * 2 - 1) * spread);
}
