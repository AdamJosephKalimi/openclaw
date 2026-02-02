/* eslint-disable no-undef */
// ── Macro Tracker Dashboard ─────────────────────────────────────────────────
// Vanilla JS — no build step. Uses Chart.js via CDN.

(function () {
  "use strict";

  // ── State ───────────────────────────────────────────────────────────────
  let currentDate = new Date();
  let currentView = "day"; // day | week | month
  let doughnutChart = null;
  let barChart = null;

  // ── DOM refs ────────────────────────────────────────────────────────────
  const dateLabel = document.getElementById("date-label");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const todayBtn = document.getElementById("today-btn");
  const viewBtns = document.querySelectorAll(".view-btn");
  const progressBars = document.getElementById("progress-bars");
  const entriesList = document.getElementById("entries-list");
  const noEntries = document.getElementById("no-entries");
  const goalsForm = document.getElementById("goals-form");
  const barChartTitle = document.getElementById("bar-chart-title");

  // ── API helpers ─────────────────────────────────────────────────────────
  const API = "/macro-tracker/api";

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  async function putJSON(url, data) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  async function deleteJSON(url) {
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── Date helpers ────────────────────────────────────────────────────────
  function formatDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function formatDisplayDate(d) {
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getWeekRange(d) {
    const day = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); // Monday
    const end = new Date(start);
    end.setDate(start.getDate() + 6); // Sunday
    return { from: formatDate(start), to: formatDate(end) };
  }

  function getMonthRange(d) {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: formatDate(start), to: formatDate(end) };
  }

  function navigate(direction) {
    if (currentView === "day") {
      currentDate.setDate(currentDate.getDate() + direction);
    } else if (currentView === "week") {
      currentDate.setDate(currentDate.getDate() + direction * 7);
    } else {
      currentDate.setMonth(currentDate.getMonth() + direction);
    }
    refresh();
  }

  // ── Update date label ─────────────────────────────────────────────────
  function updateDateLabel() {
    if (currentView === "day") {
      dateLabel.textContent = formatDisplayDate(currentDate);
    } else if (currentView === "week") {
      const { from, to } = getWeekRange(currentDate);
      dateLabel.textContent = `${from} → ${to}`;
    } else {
      dateLabel.textContent = currentDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
    }
  }

  // ── Progress bars ─────────────────────────────────────────────────────
  function renderProgressBars(totals, goals) {
    const macros = [
      { key: "calories", label: "Calories", unit: "kcal" },
      { key: "protein", label: "Protein", unit: "g" },
      { key: "carbs", label: "Carbs", unit: "g" },
      { key: "fat", label: "Fat", unit: "g" },
      { key: "fiber", label: "Fiber", unit: "g" },
    ];

    progressBars.innerHTML = macros
      .map((m) => {
        const current = Math.round(totals[m.key] || 0);
        const goal = goals ? goals[m.key] : 0;
        const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
        const goalStr = goal > 0 ? `${current}/${goal} ${m.unit}` : `${current} ${m.unit}`;

        return `
          <div class="progress-item">
            <span class="label">${m.label}</span>
            <div class="progress-bar-track">
              <div class="progress-bar-fill ${m.key}" style="width: ${pct}%"></div>
            </div>
            <span class="value">${goalStr}</span>
          </div>
        `;
      })
      .join("");
  }

  // ── Doughnut chart ────────────────────────────────────────────────────
  function renderDoughnut(totals) {
    const ctx = document.getElementById("macro-doughnut").getContext("2d");
    const data = [
      Math.round(totals.protein || 0),
      Math.round(totals.carbs || 0),
      Math.round(totals.fat || 0),
      Math.round(totals.fiber || 0),
    ];

    if (doughnutChart) {
      doughnutChart.destroy();
    }

    doughnutChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Protein", "Carbs", "Fat", "Fiber"],
        datasets: [
          {
            data: data,
            backgroundColor: [
              getComputedStyle(document.documentElement).getPropertyValue("--protein").trim(),
              getComputedStyle(document.documentElement).getPropertyValue("--carbs").trim(),
              getComputedStyle(document.documentElement).getPropertyValue("--fat").trim(),
              getComputedStyle(document.documentElement).getPropertyValue("--fiber").trim(),
            ],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#e4e6eb", padding: 12, usePointStyle: true },
          },
        },
        cutout: "65%",
      },
    });
  }

  // ── Bar chart ─────────────────────────────────────────────────────────
  function renderBarChart(days, goals) {
    const ctx = document.getElementById("calorie-bar").getContext("2d");

    if (barChart) {
      barChart.destroy();
    }

    const labels = days.map((d) => d.date);
    const calorieData = days.map((d) => Math.round(d.calories || 0));
    const goalLine = goals ? goals.calories : null;

    const datasets = [
      {
        label: "Calories",
        data: calorieData,
        backgroundColor: getComputedStyle(document.documentElement)
          .getPropertyValue("--calories")
          .trim(),
        borderRadius: 4,
        barPercentage: 0.7,
      },
    ];

    if (goalLine) {
      datasets.push({
        label: "Goal",
        data: labels.map(() => goalLine),
        type: "line",
        borderColor: getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
        borderDash: [5, 5],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      });
    }

    barChart = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: { color: "#e4e6eb" },
          },
        },
        scales: {
          x: {
            ticks: { color: "#8b8fa3", maxRotation: 45 },
            grid: { color: "rgba(255,255,255,0.05)" },
          },
          y: {
            ticks: { color: "#8b8fa3" },
            grid: { color: "rgba(255,255,255,0.05)" },
            beginAtZero: true,
          },
        },
      },
    });
  }

  // ── Entries list ──────────────────────────────────────────────────────
  function renderEntries(entries) {
    if (!entries || entries.length === 0) {
      entriesList.style.display = "none";
      noEntries.style.display = "block";
      return;
    }

    entriesList.style.display = "grid";
    noEntries.style.display = "none";

    entriesList.innerHTML = entries
      .map((entry) => {
        const time = new Date(entry.created_at).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
        const items = (entry.items || []).map((i) => `<span>${i.name}</span>`).join("");

        return `
          <div class="entry-card" data-id="${entry.id}">
            <div class="entry-header">
              <span class="entry-time">${time}</span>
              <span class="entry-source">${entry.source}</span>
            </div>
            <div class="entry-macros">
              <span class="entry-macro cal">${Math.round(entry.total_calories)} cal</span>
              <span class="entry-macro pro">${Math.round(entry.total_protein)}g P</span>
              <span class="entry-macro carb">${Math.round(entry.total_carbs)}g C</span>
              <span class="entry-macro fat">${Math.round(entry.total_fat)}g F</span>
            </div>
            <div class="entry-items">${items}</div>
            <div class="entry-actions">
              <button class="btn-delete" onclick="window.__deleteEntry('${entry.id}')">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // ── Goals form ────────────────────────────────────────────────────────
  async function loadGoals() {
    try {
      const data = await fetchJSON(`${API}/goals`);
      if (data.goals) {
        document.getElementById("goal-calories").value = data.goals.calories;
        document.getElementById("goal-protein").value = data.goals.protein;
        document.getElementById("goal-carbs").value = data.goals.carbs;
        document.getElementById("goal-fat").value = data.goals.fat;
        document.getElementById("goal-fiber").value = data.goals.fiber;
      }
    } catch (err) {
      console.error("Failed to load goals:", err);
    }
  }

  // ── Delete entry ──────────────────────────────────────────────────────
  window.__deleteEntry = async function (id) {
    if (!confirm("Delete this entry?")) {
      return;
    }
    try {
      await deleteJSON(`${API}/entries/${id}`);
      refresh();
    } catch (err) {
      console.error("Failed to delete:", err);
      alert("Failed to delete entry");
    }
  };

  // ── Main refresh ──────────────────────────────────────────────────────
  async function refresh() {
    updateDateLabel();

    try {
      if (currentView === "day") {
        barChartTitle.textContent = "Daily Calories";
        const date = formatDate(currentDate);
        const summary = await fetchJSON(`${API}/summary?date=${date}`);

        const totals = {
          calories: summary.total_calories,
          protein: summary.total_protein,
          carbs: summary.total_carbs,
          fat: summary.total_fat,
          fiber: summary.total_fiber,
        };

        renderProgressBars(totals, summary.goals);
        renderDoughnut(totals);
        renderBarChart([{ date, calories: totals.calories }], summary.goals);
        renderEntries(summary.entries);
      } else {
        const range =
          currentView === "week"
            ? getWeekRange(currentDate)
            : getMonthRange(currentDate);

        barChartTitle.textContent =
          currentView === "week" ? "Weekly Calories" : "Monthly Calories";

        const data = await fetchJSON(
          `${API}/entries?from=${range.from}&to=${range.to}`,
        );

        // Aggregate by date
        const byDate = {};
        for (const entry of data.entries || []) {
          if (!byDate[entry.date]) {
            byDate[entry.date] = {
              date: entry.date,
              calories: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              fiber: 0,
            };
          }
          const d = byDate[entry.date];
          d.calories += entry.total_calories;
          d.protein += entry.total_protein;
          d.carbs += entry.total_carbs;
          d.fat += entry.total_fat;
          d.fiber += entry.total_fiber;
        }

        const days = Object.values(byDate).toSorted((a, b) =>
          a.date.localeCompare(b.date),
        );

        // Period totals
        const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
        for (const day of days) {
          totals.calories += day.calories;
          totals.protein += day.protein;
          totals.carbs += day.carbs;
          totals.fat += day.fat;
          totals.fiber += day.fiber;
        }

        const goalsData = await fetchJSON(`${API}/goals`);
        renderProgressBars(totals, goalsData.goals);
        renderDoughnut(totals);
        renderBarChart(days, goalsData.goals);
        renderEntries(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to refresh:", err);
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────
  prevBtn.addEventListener("click", () => navigate(-1));
  nextBtn.addEventListener("click", () => navigate(1));
  todayBtn.addEventListener("click", () => {
    currentDate = new Date();
    refresh();
  });

  viewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      viewBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view;
      refresh();
    });
  });

  goalsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(goalsForm);
    const goals = {};
    for (const [key, value] of formData) {
      if (value !== "") {
        goals[key] = Number(value);
      }
    }
    try {
      await putJSON(`${API}/goals`, goals);
      refresh();
    } catch (err) {
      console.error("Failed to save goals:", err);
      alert("Failed to save goals");
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────
  loadGoals();
  refresh();
})();
