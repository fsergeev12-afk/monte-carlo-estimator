// Monte Carlo Simulation Web Worker
// Принимает задачи и прогоняет N симуляций
// Возвращает отсортированный массив и перцентили

self.onmessage = function (e) {
  const { tasks, iterations = 10000 } = e.data;

  const results = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    let total = 0;

    for (const task of tasks) {
      const { optimistic, realistic, pessimistic, weights } = task;
      // weights = [wOpt, wReal, wPes] в процентах, сумма = 100

      // Слой 1: выбираем сценарий по весам
      const rand1 = Math.random() * 100;
      let scenario;
      if (rand1 < weights[0]) {
        scenario = optimistic;
      } else if (rand1 < weights[0] + weights[1]) {
        scenario = realistic;
      } else {
        scenario = pessimistic;
      }

      // Слой 2: небольшой случайный разброс ±10% внутри сценария
      // Это добавляет реализм — одна цифра на сценарий, но не детерминировано
      const spread = scenario * 0.1;
      const value = scenario + (Math.random() * 2 - 1) * spread;

      total += Math.max(0, value);
    }

    results[i] = total;
  }

  // Сортируем для построения CDF
  results.sort((a, b) => a - b);

  // Извлекаем перцентили
  const percentiles = [50, 75, 80, 90, 95].map((p) => ({
    p,
    value: results[Math.floor((p / 100) * iterations)],
  }));

  // Строим точки для CDF графика (100 точек равномерно)
  const cdfPoints = [];
  for (let i = 0; i <= 100; i++) {
    const idx = Math.min(Math.floor((i / 100) * iterations), iterations - 1);
    cdfPoints.push({ x: results[idx], y: i });
  }

  self.postMessage({ percentiles, cdfPoints });
};
