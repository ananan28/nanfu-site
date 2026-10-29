(function () {
  var cfg = window.NANFU_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var elAuth = $("auth"), elDownloads = $("downloads"), elBoot = $("boot");
  var elForm = $("auth-form"), elEmail = $("email"), elPassword = $("password");
  var elSubmit = $("submit"), elGoogle = $("google"), elStatus = $("auth-status");
  var elAccount = $("account-email"), elQuota = $("quota"), elFiles = $("file-list");
  var elLogout = $("logout"), elTurnstile = $("turnstile");
  var elVersion = $("dl-version"), elFileNote = $("file-note");
  var tabLogin = $("tab-login"), tabSignup = $("tab-signup");

  var mode = "login";
  var session = null;
  var turnstileToken = "";
  var turnstileActive = false;
  var turnstileReady = false;
  var turnstileWidgetId = null;
  var releases = {};
  var releaseToken = null;
  var shownToken = null;
  var currentVersion = cfg.VERSION || "";

  function say(text, kind) {
    elStatus.textContent = text || "";
    elStatus.className = "status" + (kind ? " " + kind : "");
  }

  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY ||
      cfg.SUPABASE_KEY.indexOf("__") === 0) {
    elBoot.textContent = "配置未加载，请稍后刷新页面。";
    elBoot.className = "status err";
    return;
  }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" }
  });

  function versionLabel(version) {
    return String(version || currentVersion || "").replace(/^v/i, "");
  }

  function setVersion(version) {
    if (!version) return;
    currentVersion = String(version);
    if (elVersion) elVersion.textContent = "v" + versionLabel(version);
  }

  function setMode(next) {
    mode = next;
    var isLogin = next === "login";
    tabLogin.classList.toggle("is-active", isLogin);
    tabSignup.classList.toggle("is-active", !isLogin);
    tabLogin.setAttribute("aria-selected", String(isLogin));
    tabSignup.setAttribute("aria-selected", String(!isLogin));
    $("auth-title").textContent = isLogin ? "登录后下载" : "注册新账号";
    elPassword.setAttribute("autocomplete", isLogin ? "current-password" : "new-password");
    elSubmit.firstChild.nodeValue = isLogin ? "登录下载 " : "注册并下载 ";
    say("");
  }

  tabLogin.addEventListener("click", function () { setMode("login"); });
  tabSignup.addEventListener("click", function () { setMode("signup"); });

  function functionUrl(name) {
    return String(cfg.SUPABASE_URL || "").replace(/\/+$/, "") + "/functions/v1/" + name;
  }

  function requestHeaders(accessToken) {
    var headers = {
      apikey: cfg.SUPABASE_KEY,
      "Content-Type": "application/json"
    };
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    return headers;
  }

  function readJson(res) {
    try {
      return res.json().catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function formatSize(size) {
    var n = Number(size);
    if (!isFinite(n) || n <= 0) return "";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) done();
    } catch (e) { /* 复制失败时保持原文案 */ }
  }

  function copyText(text, btn) {
    var original = btn.getAttribute("data-label") || btn.textContent;
    var done = function () {
      btn.setAttribute("data-label", original);
      btn.textContent = "已复制";
      btn.classList.add("copied");
      setTimeout(function () {
        btn.textContent = original;
        btn.classList.remove("copied");
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text, done);
      });
    } else {
      fallbackCopy(text, done);
    }
  }

  function makeShaButton(sha) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sha";
    btn.textContent = "SHA256 " + sha.slice(0, 12);
    btn.title = "点击复制完整 SHA256：" + sha;
    btn.addEventListener("click", function () { copyText(sha, btn); });
    return btn;
  }

  function releaseFor(f) {
    if (releases[f.id]) return releases[f.id];
    if (f.url) {
      return {
        status: "ok",
        data: { url: f.url, version: currentVersion, fileName: "", size: 0, sha256: "" }
      };
    }
    return { status: session ? "pending" : "none" };
  }

  function statusLabel(status) {
    if (status === "pending") return "正在获取安装包…";
    if (status === "auth") return "登录并加入组织后可下载";
    if (status === "error") return "下载暂不可用，请稍后重试";
    return "内测中 · 暂未开放";
  }

  function renderFiles() {
    var files = cfg.FILES || [];
    elFiles.innerHTML = "";
    var allNone = true;

    files.forEach(function (f) {
      var state = releaseFor(f);
      if (state.status !== "none") allNone = false;
      var data = state.status === "ok" ? state.data : null;
      var version = versionLabel((data && data.version) || currentVersion);

      var card = document.createElement("div");
      card.className = "file-card";

      var h = document.createElement("h3");
      h.textContent = f.label;
      card.appendChild(h);

      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = (f.meta || "") + (data ? (f.meta ? " · " : "") + "v" + version : "");
      card.appendChild(meta);

      if (data) {
        var facts = document.createElement("div");
        facts.className = "meta file-facts";
        var sizeText = formatSize(data.size);
        if (sizeText) {
          var sz = document.createElement("span");
          sz.textContent = sizeText;
          facts.appendChild(sz);
        }
        if (data.sha256) facts.appendChild(makeShaButton(String(data.sha256)));
        if (facts.childNodes.length) card.appendChild(facts);
      }

      var a = document.createElement("a");
      a.className = "dl";
      if (data && data.url) {
        a.href = data.url;
        a.textContent = "下载安装包 · v" + version;
        a.setAttribute("rel", "noopener");
        if (data.fileName) {
          a.setAttribute("download", data.fileName);
          a.title = data.fileName;
        }
      } else {
        a.className = "dl off";
        a.href = "javascript:void(0)";
        a.setAttribute("aria-disabled", "true");
        a.textContent = statusLabel(state.status);
      }
      card.appendChild(a);
      elFiles.appendChild(card);
    });

    if (elFileNote) elFileNote.hidden = !(files.length === 0 || allNone);
  }

  function requestRelease(f, accessToken) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;

    return fetch(functionUrl("nanfu-release"), {
      method: "POST",
      headers: requestHeaders(accessToken),
      body: JSON.stringify({ action: "download", platform: f.id }),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return readJson(res).then(function (body) {
        if (res.ok && body && body.ok && body.url) {
          return { status: "ok", data: body };
        }
        if (res.status === 404 && body && body.code === "no_release") {
          return { status: "none" };
        }
        if (res.status === 401 || res.status === 403) {
          return { status: "auth" };
        }
        return { status: "error" };
      });
    }).catch(function () {
      return { status: "error" };
    }).then(function (result) {
      if (timer) clearTimeout(timer);
      return result;
    });
  }

  function loadReleases(sess) {
    var files = cfg.FILES || [];
    var token = sess && sess.access_token ? sess.access_token : "";
    if (!token || releaseToken === token) return;

    releaseToken = token;
    files.forEach(function (f) {
      if (releases[f.id] && releases[f.id].status === "ok") return;
      releases[f.id] = { status: "pending" };
    });
    renderFiles();

    Promise.all(files.map(function (f) {
      return requestRelease(f, token).then(function (result) {
        if (releaseToken !== token) return;
        releases[f.id] = result;
        if (result.status === "ok" && result.data.version) setVersion(result.data.version);
        renderFiles();
      });
    })).catch(function () {
      /* 所有请求内部已兜底，这里只防止未处理的异常外溢 */
    });
  }

  async function loadQuota() {
    try {
      var res = await sb.rpc("nanfu_org_me");
      var me = Array.isArray(res.data) ? res.data[0] : res.data;
      if (res.error || !me) { elQuota.hidden = true; return; }
      var quota = Number(me.env_quota || 0);
      elQuota.hidden = false;
      elQuota.innerHTML = quota > 0
        ? "当前可用窗口额度：<b>" + quota + "</b> 个" + (me.identity === "owner" || me.identity === "admin" ? " · 管理员不限额" : "")
        : "当前额度：<b>不限</b>";
    } catch (e) {
      elQuota.hidden = true;
    }
  }

  async function bindSelfJoin() {
    try {
      await sb.rpc("nanfu_org_self_join");
    } catch (e) { /* 已有组织时由函数自身忽略 */ }
  }

  async function showSession(sess) {
    session = sess || null;
    var token = session ? (session.access_token || session.user && session.user.id || "auth") : "";
    if (token === shownToken) return;
    shownToken = token;
    if (!session) {
      releaseToken = null;
      releases = {};
      elBoot.hidden = true;
      elAuth.hidden = false;
      elDownloads.hidden = true;
      setVersion(cfg.VERSION);
      renderFiles();
      return;
    }
    elBoot.hidden = true;
    elAuth.hidden = true;
    elDownloads.hidden = false;
    elAccount.textContent = (session.user && session.user.email) || "已登录";
    renderFiles();
    await bindSelfJoin();
    if (session !== sess || shownToken !== token) return;
    loadQuota();
    loadReleases(session);
  }

  function resetTurnstile() {
    turnstileToken = "";
    turnstileActive = false;
    if (window.turnstile && turnstileWidgetId !== null) {
      try { window.turnstile.reset(turnstileWidgetId); } catch (e) { /* ignore */ }
    }
  }

  async function signup(email, password) {
    var token = turnstileToken || "";
    var res, body = null;

    try {
      res = await fetch(functionUrl("nanfu-signup"), {
        method: "POST",
        headers: requestHeaders(""),
        body: JSON.stringify({ email: email, password: password, captchaToken: token })
      });
      body = await readJson(res);
    } catch (e) {
      say("注册暂不可用，请稍后重试", "err");
      return;
    }

    resetTurnstile();

    if (res.ok && body && body.ok) {
      if (body.email) elEmail.value = body.email;
      setMode("login");
      say("注册成功，请登录", "ok");
      return;
    }

    if (!token) {
      say("人机验证未加载，请刷新页面重试", "err");
      return;
    }

    if ((res.status === 400 || res.status === 429) && body && body.error) {
      say(String(body.error), "err");
      return;
    }

    say("注册暂不可用，请稍后重试", "err");
  }

  elForm.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var email = elEmail.value.trim();
    var password = elPassword.value;
    if (!email || !password) { say("请填写邮箱和密码。", "err"); return; }
    if (mode === "signup" && password.length < 6) { say("密码至少 6 位。", "err"); return; }
    if (mode === "signup" && turnstileReady && !turnstileToken) {
      say("请先完成人机验证。", "err");
      return;
    }

    elSubmit.disabled = true;
    say(mode === "login" ? "正在登录…" : "正在创建账号…");

    try {
      if (mode === "login") {
        var r = await sb.auth.signInWithPassword({ email: email, password: password });
        if (r.error) throw r.error;
        say("");
      } else {
        await signup(email, password);
      }
    } catch (err) {
      say(translate(err), "err");
    } finally {
      elSubmit.disabled = false;
    }
  });

  elGoogle.addEventListener("click", async function () {
    say("正在跳转 Google…");
    var r = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname }
    });
    if (r.error) say(translate(r.error), "err");
  });

  elLogout.addEventListener("click", async function () {
    try { await sb.auth.signOut(); } catch (e) { /* 即使网络失败也回到未登录界面 */ }
    elEmail.value = "";
    elPassword.value = "";
    releaseToken = null;
    releases = {};
    showSession(null);
    setMode("login");
  });

  function translate(err) {
    var m = (err && (err.message || err.error_description || err.msg)) || String(err);
    if (/Invalid login credentials/i.test(m)) return "邮箱或密码不正确。";
    if (/already registered|User already exists/i.test(m)) return "该邮箱已注册，请直接登录。";
    if (/Password should be at least/i.test(m)) return "密码太短，至少 6 位。";
    if (/Email not confirmed/i.test(m)) return "邮箱还没确认，请先点邮件里的链接。";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "网络异常，请稍后重试。";
    if (/rate limit|too many/i.test(m)) return "尝试太频繁，请稍后再试。";
    return m;
  }

  function mountTurnstile() {
    if (!cfg.TURNSTILE_SITE_KEY) return;
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = function () {
      if (!window.turnstile) { turnstileReady = false; return; }
      try {
        turnstileWidgetId = window.turnstile.render(elTurnstile, {
          sitekey: cfg.TURNSTILE_SITE_KEY,
          theme: "dark",
          size: "flexible",
          callback: function (token) {
            turnstileToken = token;
            turnstileActive = true;
            turnstileReady = true;
          },
          "error-callback": function () {
            turnstileActive = false;
            turnstileToken = "";
            turnstileReady = false;
            elTurnstile.hidden = true;
          },
          "expired-callback": function () {
            turnstileActive = false;
            turnstileToken = "";
          }
        });
        turnstileReady = true;
      } catch (e) {
        turnstileReady = false;
      }
    };
    s.onerror = function () { turnstileReady = false; };
    document.head.appendChild(s);
  }

  setVersion(cfg.VERSION);
  mountTurnstile();
  setMode("login");

  sb.auth.getSession().then(function (r) {
    showSession(r.data ? r.data.session : null);
  }).catch(function () {
    showSession(null);
  });

  sb.auth.onAuthStateChange(function (_evt, sess) {
    showSession(sess);
  });
})();
