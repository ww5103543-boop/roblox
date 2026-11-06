(function () {
  const sessionForm = document.getElementById("session-form");
  const sessionValue = document.getElementById("session-value");
  const sessionSubmit = document.getElementById("session-submit");
  const loginError = document.getElementById("login-error");
  const sessionAuth = document.getElementById("session-auth");
  const currentSession = document.getElementById("current-session");
  const currentAccount = document.getElementById("current-account");
  const continueSession = document.getElementById("continue-session");
  const logoutSession = document.getElementById("logout-session");

  function showError(msg) {
    if (!loginError) return;
    if (msg) {
      loginError.textContent = msg;
      loginError.hidden = false;
    } else {
      loginError.textContent = "";
      loginError.hidden = true;
    }
  }

  // Live input validation to enable/disable Log In button
  if (sessionValue && sessionSubmit) {
    sessionValue.addEventListener("input", () => {
      const val = (sessionValue.value || "").trim();
      sessionSubmit.disabled = val.length === 0;
      showError("");
    });
  }

  // Check if session already active
  async function checkCurrentSession() {
    try {
      const res = await fetch("/api/session");
      if (res.ok) {
        const data = await res.json();
        if (data && (data.authenticated || data.user)) {
          showActiveSession(data.user);
          return;
        }
      }
    } catch (e) {}

    const savedCookie = localStorage.getItem("weblox_rbx_cookie");
    if (savedCookie) {
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionValue: savedCookie }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && (data.ok || data.user)) {
            showActiveSession(data.user);
            return;
          }
        }
      } catch (e) {}
    }
  }

  function showActiveSession(user) {
    if (sessionAuth) sessionAuth.hidden = true;
    if (currentSession) currentSession.hidden = false;
    if (currentAccount) {
      const dName = (user && (user.displayName || user.name)) || "Roblox Player";
      const uName = (user && user.name) || dName;
      currentAccount.textContent = `Logged in as ${dName} (@${uName})`;
    }
  }

  // Handle Form Submission
  if (sessionForm) {
    sessionForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = (sessionValue && sessionValue.value ? sessionValue.value : "").trim();
      if (!val) return;

      showError("");
      if (sessionSubmit) {
        sessionSubmit.disabled = true;
        sessionSubmit.textContent = "Verifying...";
      }

      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionValue: val }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.ok || data.user)) {
          localStorage.setItem("weblox_rbx_cookie", val);
          localStorage.setItem("weblox_user_logged_in", "1");
          window.location.href = "/";
          return;
        } else {
          const errMsg = (data && data.error) ? data.error : "Invalid .ROBLOSECURITY cookie. Please check and try again.";
          showError(errMsg);
        }
      } catch (err) {
        showError("Failed to reach server. Please check your connection.");
      } finally {
        if (sessionSubmit) {
          sessionSubmit.disabled = false;
          sessionSubmit.textContent = "Log In";
        }
      }
    });
  }

  // Continue to home
  if (continueSession) {
    continueSession.addEventListener("click", () => {
      window.location.href = "/";
    });
  }

  // Log Out
  if (logoutSession) {
    logoutSession.addEventListener("click", async () => {
      try {
        await fetch("/api/rbx/logout", { method: "POST" });
      } catch (e) {}
      localStorage.removeItem("weblox_rbx_cookie");
      localStorage.removeItem("weblox_user_logged_in");
      if (currentSession) currentSession.hidden = true;
      if (sessionAuth) sessionAuth.hidden = false;
      if (sessionValue) {
        sessionValue.value = "";
        sessionValue.focus();
      }
      if (sessionSubmit) sessionSubmit.disabled = true;
      showError("");
    });
  }

  checkCurrentSession();
})();

