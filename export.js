// Экспорт результатов: PNG и CSV

export function exportCSV(projectName, unit, rate, rateUnit, percentiles) {
  const unitLabel = unit === 'days' ? 'дней' : 'недель';
  const hasRate = rate && rate > 0;
  const rateLabelStr = rateUnit === 'hour' ? `${rate} ₽/час` : `${rate} ₽/день`;

  let csv = '\uFEFF'; // BOM для корректного открытия в Excel
  csv += `Проект: ${projectName}\n`;
  csv += `Единица измерения: ${unitLabel}\n`;
  if (hasRate) csv += `Ставка команды: ${rateLabelStr}\n`;
  csv += '\n';

  if (hasRate) {
    csv += 'Вероятность,Срок,Стоимость (₽)\n';
    percentiles.forEach(({ p, value }) => {
      const cost = calcCost(value, rateUnit, rate);
      csv += `${p}%,${formatValue(value, unit)},${formatCost(cost)}\n`;
    });
  } else {
    csv += 'Вероятность,Срок\n';
    percentiles.forEach(({ p, value }) => {
      csv += `${p}%,${formatValue(value, unit)}\n`;
    });
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `monte-carlo-${slugify(projectName)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportPNG(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const script = document.createElement('script');
  script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
  document.head.appendChild(script);

  await new Promise((resolve) => (script.onload = resolve));

  const canvas = await window.html2canvas(el, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
  });

  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'monte-carlo-результаты.png';
  a.click();
}

export function shareToTelegram(projectName, unit, rate, rateUnit, percentiles) {
  const unitLabel = unit === 'days' ? 'дн.' : 'нед.';
  const hasRate = rate && rate > 0;
  const rateLabelStr = rateUnit === 'hour' ? `${rate} ₽/час` : `${rate} ₽/день`;

  const p50 = percentiles.find((p) => p.p === 50);
  const p80 = percentiles.find((p) => p.p === 80);
  const p95 = percentiles.find((p) => p.p === 95);

  let text = `📊 Monte Carlo: ${projectName}\n\n`;
  text += `🎯 Базовый (50%): ${formatValue(p50.value, unit)} ${unitLabel}\n`;
  text += `📋 Для плана (80%): ${formatValue(p80.value, unit)} ${unitLabel}\n`;
  text += `🛡️ С запасом (95%): ${formatValue(p95.value, unit)} ${unitLabel}\n`;

  if (hasRate) {
    const cost80 = calcCost(p80.value, rateUnit, rate);
    text += `\n💰 Стоимость (80%): ${formatCost(cost80)} ₽\n`;
    text += `📌 Ставка: ${rateLabelStr}\n`;
  }

  text += '\n🎲 Рассчитано методом Монте-Карло (10 000 симуляций)';

  if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.sendData(text);
  } else {
    // Fallback: копируем в буфер
    navigator.clipboard.writeText(text).then(() => {
      showToast('Скопировано в буфер обмена!');
    });
  }
}

// --- Утилиты ---

export function formatValue(value, unit) {
  if (unit === 'days') {
    return Math.round(value).toString();
  } else {
    return (value / 5).toFixed(1); // дни → недели (5 рабочих дней)
  }
}

/**
 * Расчёт стоимости.
 * value  — всегда в рабочих днях (внутреннее представление)
 * rateUnit — 'hour' | 'day'
 * rate   — ставка в ₽
 *
 * Если ₽/час : стоимость = дни × 8 часов × ставка
 * Если ₽/день: стоимость = дни × ставка
 * (1 неделя = 5 дней — уже учтено, т.к. value в днях)
 */
export function calcCost(value, rateUnit, rate) {
  if (rateUnit === 'hour') {
    return Math.round(value * 8 * rate);
  } else {
    return Math.round(value * rate);
  }
}

export function formatCost(cost) {
  if (cost >= 1000000) {
    return (cost / 1000000).toFixed(1) + ' млн';
  } else if (cost >= 1000) {
    return (cost / 1000).toFixed(0) + ' тыс.';
  }
  return cost.toString();
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 30);
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}
