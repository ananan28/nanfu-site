(function () {
  var cfg = window.NANFU_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var elAuth = $("auth"), elDownloads = $("downloads"), elBoot = $("boot");
  var elForm = $("auth-form"), elEmail = $("email"), elPassword = $("password");
  var elSubmit = $("submit"), elGoogle = $("google"), elStatus = $("auth-status");
  var elAccount = $("account-email"), elQuota = $("quota"), elFiles = $("file-list");
  var elLogout = $("logout"), elTurnstile = $("turnstile");
  var tabLogin = $("tab-login"), tabSignup = $("tab-signup");

  var mode = "login";
  var turnstileToken = "";

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

  function renderFiles() {
    elFiles.innerHTML = "";
    (cfg.FILES || []).forEach(function (f) {
      var card = document.createElement("div");
      card.className = "file-card";

      var h = document.createElement("h3");
      h.textContent = f.label;
      card.appendChild(h);

      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = f.meta + (f.url ? " · v" + cfg.VERSION : "");
      card.appendChild(meta);

      var a = document.createElement("a");
      a.className = "dl" + (f.url ? "" : " off");
      a.textContent = f.url ? "下载安装包" : "内测中 · 暂未开放";
      if (f.url) {
        a.href = f.url;
        a.setAttribute("rel", "noopener");
      } else {
        a.href = "javascript:void(0)";
        a.setAttribute("aria-disabled", "true");
      }
      card.appendChild(a);

      elFiles.appendChild(card);
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

  async function showSession(session) {
    if (!session) {
      elBoot.hidden = true;
      elAuth.hidden = false;
      elDownloads.hidden = true;
      return;
    }
    elBoot.hidden = true;
    elAuth.hidden = true;
    elDownloads.hidden = false;
    elAccount.textContent = session.user.email || "已登录";
    renderFiles();
    await bindSelfJoin();
    loadQuota();
  }

  elForm.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var email = elEmail.value.trim();
    var password = elPassword.value;
    if (!email || !password) { say("请填写邮箱和密码。", "err"); return; }
    if (mode === "signup" && password.length < 6) { say("密码至少 6 位。", "err"); return; }
    if (elTurnstile && elTurnstile.childElementCount && !turnstileToken) {
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
        var s = await sb.auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: location.origin + location.pathname }
        });
        if (s.error) throw s.error;
        if (!s.data.session) {
          say("注册成功，请到邮箱点击确认链接后再登录。", "ok");
        }
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
    await sb.auth.signOut();
    elEmail.value = "";
    elPassword.value = "";
    setMode("login");
  });

  function translate(err) {
    var m = (err && (err.message || err.error_description || err.msg)) || String(err);
    if (/Invalid login credentials/i.test(m)) return "邮箱或密码不正确。";
    if (/already registered|User already exists/i.test(m)) return "该邮箱已注册，请直接登录。";
    if (/Password should be at least/i.test(m)) return "密码太短，至少 6 位。";
    if (/Email not confirmed/i.test(m)) return "邮箱还没确认，请先点邮件里的链接。";
    if (/rate limit|too many/i.test(m)) return "尝试太频繁，请稍后再试。";
    return m;
  }

  function mountTurnstile() {
    if (!cfg.TURNSTILE_SITE_KEY) return;
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = function () {
      if (!window.turnstile) return;
      window.turnstile.render(elTurnstile, {
        sitekey: cfg.TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: function (token) { turnstileToken = token; }
      });
    };
    document.head.appendChild(s);
  }

  mountTurnstile();
  setMode("login");

  sb.auth.getSession().then(function (r) {
    showSession(r.data ? r.data.session : null);
  });

  sb.auth.onAuthStateChange(function (_evt, session) {
    showSession(session);
  });
})();
