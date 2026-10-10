(function initIndexPage() {
  async function load() {
    try {
      const [health, stats] = await Promise.all([Pilot.api("/health"), Pilot.api("/stats")]);
      document.getElementById("health-pill").textContent = health.llm_configured ? "LLM 已配置" : "LLM 未配置 · 使用 fallback";
      document.getElementById("health-pill").className = `pill ${health.llm_configured ? "ok" : "warn"}`;
      document.getElementById("stat-cases").textContent = stats.cases;
      document.getElementById("stat-encounters").textContent = stats.encounters;
      document.getElementById("stat-attempts").textContent = stats.attempts;
      document.getElementById("stat-pending").textContent = stats.pending_adjudication;
      document.getElementById("stats-time").textContent = new Date().toLocaleTimeString();
    } catch (err) { Pilot.toast(err.message, "error"); }
  }

  async function boot() {
    const allowed = await Pilot.requireLogin(["doctor", "interviewer", "curator", "admin"]);
    if (!allowed) return;
    Pilot.mountUserBadge();
    document.getElementById("export-btn").addEventListener("click", async () => {
      try {
        const row = await Pilot.api("/exports", { method: "POST", body: JSON.stringify({}) });
        Pilot.toast(`导出完成：${row.row_count} 条，目录 ${row.export_dir}`, "ok");
      } catch (err) { Pilot.toast(err.message, "error"); }
    });
    load();
  }

  boot();
})();
