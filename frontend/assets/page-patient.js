(function initPatientPage() {
  const state = { view: null, token: null, session: null, activeQuestionId: null };
  const els = {
    status: document.getElementById("status-pill"),
    complaint: document.getElementById("chief-complaint"),
    chat: document.getElementById("chat"),
    answer: document.getElementById("answer"),
    send: document.getElementById("send"),
  };

  function disableComposer() {
    els.answer.disabled = true;
    els.send.disabled = true;
    document.querySelectorAll(".quick button").forEach((button) => { button.disabled = true; });
  }

  async function boot() {
    try {
      state.token = new URLSearchParams(location.search).get("token");
      if (!state.token) {
        els.status.textContent = "链接无效或已过期";
        els.status.className = "pill danger";
        els.chat.innerHTML = `<div class="empty">链接无效或已过期</div>`;
        disableComposer();
        return;
      }
      els.status.textContent = "已连接";
      els.status.className = "pill ok";
      await refresh();
      setInterval(() => { refresh().catch(() => {}); }, 2500);
    } catch (err) {
      els.status.textContent = "连接失败";
      els.status.className = "pill danger";
      Pilot.toast(err.message, "error");
    }
  }

  async function refresh() {
    if (!state.token) return;
    state.session = await Pilot.api(`/patient/session/${encodeURIComponent(state.token)}`);
    els.complaint.textContent = state.session.chief_complaint || "未记录";
    renderQueue(state.session);
  }

  function renderQueue(session) {
    const questions = session.questions || [];
    if (!questions.length) {
      els.chat.innerHTML = `<div class="empty">目前没有需要回答的问题。问题准备好后会出现在这里。</div>`;
      return;
    }
    if (!state.activeQuestionId || !questions.some((q) => q.question_event_id === state.activeQuestionId)) {
      state.activeQuestionId = questions[0].question_event_id;
    }
    els.chat.innerHTML = questions.map((q) => `
      <div class="bubble interviewer patient-question${q.question_event_id === state.activeQuestionId ? " active" : ""}">
        <span class="who">医生问题 · ${Pilot.escapeHtml(q.status)}</span>
        ${Pilot.escapeHtml(q.question_text)}
        <div class="patient-question-actions">
          <button class="chip" data-question="${Pilot.escapeHtml(q.question_event_id)}">回答这一题</button>
        </div>
      </div>
    `).join("");
    els.chat.querySelectorAll("[data-question]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeQuestionId = button.dataset.question;
        renderQueue(session);
      });
    });
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  async function sendAnswer(text, answerStatus = "answered") {
    if (answerStatus === "answered" && !text.trim()) return Pilot.toast("请先输入回答", "error");
    try {
      if (state.token && state.activeQuestionId) {
        await Pilot.api(`/patient/session/${encodeURIComponent(state.token)}/questions/${state.activeQuestionId}/view`, {
          method: "POST",
        });
        await Pilot.api(`/patient/session/${encodeURIComponent(state.token)}/questions/${state.activeQuestionId}/answer`, {
          method: "POST",
          body: JSON.stringify({
            answer_text: answerStatus === "answered" ? text.trim() : null,
            answer_status: answerStatus,
            input_mode: "typed",
          }),
        });
      }
      els.answer.value = "";
      await refresh();
      Pilot.toast("回答已发送");
    } catch (err) { Pilot.toast(err.message, "error"); }
  }

  els.send.addEventListener("click", () => sendAnswer(els.answer.value));
  els.answer.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") sendAnswer(els.answer.value);
  });
  document.querySelectorAll(".quick button").forEach((button) => {
    button.addEventListener("click", () => sendAnswer(button.dataset.text || button.textContent, button.dataset.status || "answered"));
  });
  boot();
})();
