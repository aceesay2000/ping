(function () {
  "use strict";

  var CATEGORY_COLORS = {
    Personal: "#007AFF", Work: "#FF9F0A", School: "#AF52DE",
    Errands: "#30D158", Health: "#FF375F", Other: "#8E8E93",
  };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTime(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function fmtDayLabel(iso) {
    var d = new Date(iso), today = new Date(), tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, tomorrow)) return "Tomorrow";
    return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  }
  function isToday(iso) {
    if (!iso) return false;
    return new Date(iso).toDateString() === new Date().toDateString();
  }
  function isFuture(iso) {
    if (!iso) return false;
    var d = new Date(iso), today = new Date();
    return d.toDateString() !== today.toDateString() && d.getTime() > today.getTime() - 86400000;
  }

  // ---------- persistence (real localStorage, not the Claude.ai sandbox API) ----------
  function loadTasks() {
    try { return JSON.parse(localStorage.getItem("ping:tasks") || "[]"); }
    catch (e) { return []; }
  }
  function saveTasks(tasks) {
    try { localStorage.setItem("ping:tasks", JSON.stringify(tasks)); } catch (e) {}
  }
  function loadMessages() {
    try {
      var raw = localStorage.getItem("ping:messages");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [{ id: "welcome", role: "ai", text: "Tell me what's on your mind — I'll take it from here." }];
  }
  function saveMessages(messages) {
    try { localStorage.setItem("ping:messages", JSON.stringify(messages)); } catch (e) {}
  }

  // ---------- backend call (real server proxy, never calls Anthropic from the browser) ----------
  function parseTaskWithAI(message, context) {
    var now = new Date();
    return fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        context: context,
        nowString: now.toString(),
        weekday: now.toLocaleDateString([], { weekday: "long" }),
      }),
    }).then(function (r) {
      if (!r.ok) throw new Error("Request failed");
      return r.json();
    });
  }

  // ---------- state ----------
  var state = {
    tab: "capture",
    tasks: loadTasks(),
    messages: loadMessages(),
    busy: false,
    pendingContext: null,
    listening: false,
  };

  var recognition = null;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = function (e) {
      var transcript = e.results[0][0].transcript;
      state.listening = false;
      submitMessage(transcript);
    };
    recognition.onerror = function () { state.listening = false; render(); };
    recognition.onend = function () { state.listening = false; };
  }

  function addTask(parsed) {
    var t = {
      id: uid(), title: parsed.title, due_date: parsed.due_date,
      reminder_time: parsed.reminder_time, category: parsed.category || "Other",
      priority: parsed.priority || "none", repeat_rule: parsed.repeat_rule,
      completed: false, created_at: new Date().toISOString(),
    };
    state.tasks.push(t);
    saveTasks(state.tasks);
    return t;
  }

  function submitMessage(text) {
    var input = document.getElementById("composer-input");
    var trimmed = (text != null ? text : (input ? input.value : "")).trim();
    if (!trimmed || state.busy) return;
    if (input) input.value = "";
    state.messages.push({ id: uid(), role: "user", text: trimmed });
    state.busy = true;
    saveMessages(state.messages);
    render();

    var context = state.pendingContext
      ? "User: " + state.pendingContext.original + "\nPing: " + state.pendingContext.question + "\nUser: " + trimmed
      : null;

    parseTaskWithAI(trimmed, context).then(function (parsed) {
      if (parsed.confidence === "low" && parsed.clarifying_question) {
        state.messages.push({ id: uid(), role: "ai", text: parsed.clarifying_question, soft: true });
        state.pendingContext = { original: trimmed, question: parsed.clarifying_question };
      } else {
        addTask(parsed);
        state.messages.push({
          id: uid(), role: "ai",
          text: "\u2705 " + parsed.confirmation,
          soft: parsed.confidence === "medium",
        });
        state.pendingContext = null;
      }
    }).catch(function () {
      state.messages.push({ id: uid(), role: "ai", text: "I couldn't quite catch that — mind trying again?", soft: true });
    }).finally(function () {
      state.busy = false;
      saveMessages(state.messages);
      render();
      scrollChatToBottom();
    });
  }

  function toggleTask(id) {
    state.tasks = state.tasks.map(function (t) { return t.id === id ? Object.assign({}, t, { completed: !t.completed }) : t; });
    saveTasks(state.tasks); render();
  }
  function deleteTask(id) {
    state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
    saveTasks(state.tasks); render();
  }
  function snoozeTask(id) {
    state.tasks = state.tasks.map(function (t) {
      if (t.id !== id || !t.due_date) return t;
      var d = new Date(t.due_date);
      d.setMinutes(d.getMinutes() + 15);
      return Object.assign({}, t, { due_date: d.toISOString() });
    });
    saveTasks(state.tasks); render();
  }
  function toggleMic() {
    if (!recognition) return;
    if (state.listening) { recognition.stop(); state.listening = false; }
    else { state.listening = true; recognition.start(); }
    render();
  }
  function scrollChatToBottom() {
    var el = document.getElementById("chat-scroll");
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ---------- rendering ----------
  function taskCardHTML(t) {
    var color = CATEGORY_COLORS[t.category] || "#8E8E93";
    return '' +
      '<div style="display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:12px 14px;margin-bottom:8px;border:1px solid #EFEFF1;">' +
        '<button data-action="toggle" data-id="' + t.id + '" style="background:none;border:none;padding:0;cursor:pointer;flex-shrink:0;">' +
          (t.completed
            ? '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#007AFF"/><path d="M7 12l3.5 3.5L17 8" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="none" stroke="#C7C7CC" stroke-width="1.5"/></svg>') +
        '</button>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:15.5px;font-weight:500;color:' + (t.completed ? '#AEAEB2' : '#1C1C1E') + ';text-decoration:' + (t.completed ? 'line-through' : 'none') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(t.title) + '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">' +
            '<span style="width:6px;height:6px;border-radius:50%;background:' + color + ';"></span>' +
            '<span style="font-size:12.5px;color:#8E8E93;">' + esc(t.category) + '</span>' +
            (t.due_date ? '<span style="color:#D1D1D6;">\u00b7</span><span style="font-size:12.5px;color:#8E8E93;">' + fmtTime(t.due_date) + '</span>' : '') +
            (t.repeat_rule ? '<span style="color:#D1D1D6;">\u00b7</span><span style="font-size:12.5px;color:#8E8E93;">' + esc(t.repeat_rule) + '</span>' : '') +
          '</div>' +
        '</div>' +
        (!t.completed && t.due_date ? '<button data-action="snooze" data-id="' + t.id + '" style="background:#F2F2F7;border:none;border-radius:8px;padding:6px 8px;cursor:pointer;flex-shrink:0;">\u23F1</button>' : '') +
        '<button data-action="delete" data-id="' + t.id + '" style="background:none;border:none;cursor:pointer;flex-shrink:0;padding:4px;color:#D1D1D6;font-size:15px;">\u2715</button>' +
      '</div>';
  }

  function emptyStateHTML(text) {
    return '<div style="text-align:center;padding:60px 20px;color:#C7C7CC;font-size:14.5px;">' + esc(text) + '</div>';
  }

  function render() {
    var root = document.getElementById("root");
    var tabs = [
      { key: "capture", label: "Capture" },
      { key: "today", label: "Today" },
      { key: "upcoming", label: "Upcoming" },
      { key: "completed", label: "Done" },
    ];

    var todayTasks = state.tasks.filter(function (t) { return !t.completed && isToday(t.due_date); })
      .sort(function (a, b) { return new Date(a.due_date) - new Date(b.due_date); });
    var noDateTasks = state.tasks.filter(function (t) { return !t.completed && !t.due_date; });
    var upcomingTasks = state.tasks.filter(function (t) { return !t.completed && isFuture(t.due_date); })
      .sort(function (a, b) { return new Date(a.due_date) - new Date(b.due_date); });
    var completedTasks = state.tasks.filter(function (t) { return t.completed; })
      .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });

    var todayCount = todayTasks.length;

    var header = '<div style="padding:18px 20px 12px;background:#fff;border-bottom:1px solid #EFEFF1;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">' +
      '<div style="font-size:22px;font-weight:700;letter-spacing:-0.4px;">' +
        (state.tab === "capture" ? "Ping" : state.tab === "today" ? "Today" : state.tab === "upcoming" ? "Upcoming" : "Completed") +
      '</div>' +
      (state.tab !== "capture" ? '<div style="font-size:13px;color:#8E8E93;">' + new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + '</div>' : '') +
      '</div>';

    var body = '<div id="chat-scroll" style="flex:1;overflow-y:auto;padding:16px 16px 8px;">';

    if (state.tab === "capture") {
      state.messages.forEach(function (m) {
        var isUser = m.role === "user";
        body += '<div style="display:flex;justify-content:' + (isUser ? "flex-end" : "flex-start") + ';margin-bottom:10px;gap:8px;">' +
          (!isUser ? '<div style="width:30px;height:30px;border-radius:9px;background:#007AFF;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><div style="width:8px;height:8px;border-radius:50%;background:#fff;"></div></div>' : '') +
          '<div style="max-width:76%;background:' + (isUser ? "#007AFF" : (m.soft ? "#FFF4E5" : "#F2F2F7")) + ';color:' + (isUser ? "#fff" : "#1C1C1E") + ';padding:10px 14px;border-radius:18px;border-bottom-right-radius:' + (isUser ? "4px" : "18px") + ';border-bottom-left-radius:' + (isUser ? "18px" : "4px") + ';font-size:15.5px;line-height:1.4;">' + esc(m.text) + '</div>' +
        '</div>';
      });
      if (state.busy) {
        body += '<div style="display:flex;gap:8px;"><div style="width:30px;height:30px;border-radius:9px;background:#007AFF;display:flex;align-items:center;justify-content:center;"><div style="width:8px;height:8px;border-radius:50%;background:#fff;"></div></div>' +
          '<div style="background:#F2F2F7;padding:10px 14px;border-radius:18px;"><span style="display:inline-flex;gap:3px;">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:#C7C7CC;animation:blink 1s infinite;"></span>' +
          '<span style="width:6px;height:6px;border-radius:50%;background:#C7C7CC;animation:blink 1s infinite 0.2s;"></span>' +
          '<span style="width:6px;height:6px;border-radius:50%;background:#C7C7CC;animation:blink 1s infinite 0.4s;"></span></span></div></div>';
      }
    } else if (state.tab === "today") {
      if (todayTasks.length === 0 && noDateTasks.length === 0) {
        body += emptyStateHTML("Nothing on today. Capture a thought to get started.");
      } else {
        todayTasks.forEach(function (t) { body += taskCardHTML(t); });
        if (noDateTasks.length) {
          body += '<div style="font-size:12.5px;color:#8E8E93;margin:16px 4px 8px;text-transform:uppercase;">No date</div>';
          noDateTasks.forEach(function (t) { body += taskCardHTML(t); });
        }
      }
    } else if (state.tab === "upcoming") {
      if (upcomingTasks.length === 0) {
        body += emptyStateHTML("Nothing scheduled ahead yet.");
      } else {
        var groups = {};
        upcomingTasks.forEach(function (t) {
          var label = fmtDayLabel(t.due_date);
          groups[label] = groups[label] || [];
          groups[label].push(t);
        });
        Object.keys(groups).forEach(function (label) {
          body += '<div style="font-size:12.5px;color:#8E8E93;margin:10px 4px 8px;text-transform:uppercase;">' + esc(label) + '</div>';
          groups[label].forEach(function (t) { body += taskCardHTML(t); });
        });
      }
    } else if (state.tab === "completed") {
      if (completedTasks.length === 0) body += emptyStateHTML("Nothing completed yet — it'll show up here.");
      else completedTasks.forEach(function (t) { body += taskCardHTML(t); });
    }
    body += '</div>';

    var composer = "";
    if (state.tab === "capture") {
      composer = '<div style="padding:10px 14px 14px;background:#fff;border-top:1px solid #EFEFF1;flex-shrink:0;">' +
        '<div style="display:flex;align-items:flex-end;gap:8px;background:#F2F2F7;border-radius:22px;padding:6px 6px 6px 16px;">' +
        '<input id="composer-input" placeholder="' + (state.listening ? "Listening\u2026" : "Call mom tomorrow after work\u2026") + '" style="flex:1;border:none;background:transparent;outline:none;font-size:15.5px;padding:10px 0;color:#1C1C1E;" />' +
        (recognition ? '<button data-action="mic" style="width:36px;height:36px;border-radius:50%;border:none;flex-shrink:0;background:' + (state.listening ? "#FF375F" : "transparent") + ';cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;">\uD83C\uDFA4</button>' : '') +
        '<button data-action="send" style="width:36px;height:36px;border-radius:50%;border:none;flex-shrink:0;background:#007AFF;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;">\u2191</button>' +
        '</div></div>';
    }

    var tabBar = '<div style="display:flex;background:#fff;border-top:1px solid #EFEFF1;padding:8px 4px calc(8px + env(safe-area-inset-bottom, 0px));flex-shrink:0;">' +
      tabs.map(function (tinfo) {
        var active = state.tab === tinfo.key;
        var count = tinfo.key === "today" ? todayCount : 0;
        return '<button data-action="tab" data-tab="' + tinfo.key + '" style="flex:1;background:none;border:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 0;position:relative;">' +
          '<div style="width:22px;height:22px;border-radius:50%;border:2px solid ' + (active ? "#007AFF" : "#8E8E93") + ';"></div>' +
          '<span style="font-size:10.5px;color:' + (active ? "#007AFF" : "#8E8E93") + ';font-weight:' + (active ? "600" : "400") + ';">' + tinfo.label + '</span>' +
          (count ? '<span style="position:absolute;top:0;right:28%;background:#FF375F;color:#fff;border-radius:8px;font-size:9.5px;font-weight:700;padding:1px 5px;min-width:14px;text-align:center;">' + count + '</span>' : '') +
        '</button>';
      }).join('') +
      '</div>';

    root.innerHTML = header + body + composer + tabBar;
    scrollChatToBottom();
  }

  // ---------- event delegation ----------
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    if (action === "tab") { state.tab = btn.getAttribute("data-tab"); render(); }
    else if (action === "toggle") toggleTask(id);
    else if (action === "delete") deleteTask(id);
    else if (action === "snooze") snoozeTask(id);
    else if (action === "mic") toggleMic();
    else if (action === "send") submitMessage();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "composer-input") submitMessage();
  });

  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
