// Экспорт результатов: PNG и CSV

export function exportCSV(projectName, unit, rate, percentiles) {
  const unitLabel = unit === 'days' ? 'дней' : 'недель';
  const hasRate = rate && rate > 0;

  let csv = '\uFEFF'; // BOM для корректного открытия в Excel
  csv += `Проект: ${projectName}\n`;
  csv += `Единица измерения: ${unitLabel}\n`;
  if (hasRate) csv += `Ставка команды: ${rate} ₽/час\n`;
  csv += '\n';

  if (hasRate) {
    csv += 'Вероятность,Срок,Стоимость (₽)\n';
    percentiles.forEach(({ p, value }) => {
      const cost = calcCost(value, unit, rate);
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

export function shareToTelegram(projectName, unit, rate, percentiles) {
  const unitLabel = unit === 'days' ? 'дн.' : 'нед.';
  const hasRate = rate && rate > 0;

  const p50 = percentiles.find((p) => p.p === 50);
  const p80 = percentiles.find((p) => p.p === 80);
  const p95 = percentiles.find((p) => p.p === 95);

  let text = `📊 Monte Carlo: ${projectName}\n\n`;
  text += `🎯 Базовый (50%): ${formatValue(p50.value, unit)} ${unitLabel}\n`;
  text += `📋 Для плана (80%): ${formatValue(p80.value, unit)} ${unitLabel}\n`;
  text += `🛡️ С запасом (95%): ${formatValue(p95.value, unit)} ${unitLabel}\n`;

  if (hasRate) {
    text += `\n💰 Стоимость (80%): ${formatCost(calcCost(p80.value, unit, rate))} ₽\n`;
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

export function calcCost(value, unit, rate) {
  // value в днях, 1 день = 8 часов
  const hours = value * 8;
  return Math.round(hours * rate);
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
