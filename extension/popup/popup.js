const api = globalThis.browser ?? globalThis.chrome;

// Load the bundled English wording. Every write requires a non-empty message:
// getMessage() returns "" for an unknown key, and blanking a <label> would
// leave a checkbox with no clickable text. A missing translation therefore
// degrades to English rather than to an empty popup.
function localize() {
  const i18n = api?.i18n;
  if (!i18n?.getMessage) return;

  for (const el of document.querySelectorAll("[data-i18n]")) {
    const message = i18n.getMessage(el.dataset.i18n);
    if (message) el.textContent = message;
  }
}

async function messageActiveTab(message) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) return api.tabs.sendMessage(tab.id, message);
}

function notifyActiveTab() {
  messageActiveTab(REFRESH_SETTINGS).catch(() => {
    // There may be no receiver if the active tab is outside LinkedIn.
  });
}

function initAllowedAccounts(stored) {
  const form = document.getElementById("allowedAccountsForm");
  const controls = document.getElementById("allowedAccountsControls");
  const input = document.getElementById("accountUrl");
  const list = document.getElementById("allowedAccountsList");
  const status = document.getElementById("accountStatus");
  const pageButton = document.getElementById("allowPageAccount");
  let accounts = normalizeAllowedAccounts(stored);
  let pageAccount = null;

  function renderPageButton() {
    const allowed = accounts.includes(pageAccount);
    pageButton.hidden = !pageAccount;
    pageButton.disabled = controls.disabled || allowed;
    pageButton.textContent = allowed ? "Account allowed" : "Allow this account";
    if (pageAccount) pageButton.setAttribute("aria-label", `${pageButton.textContent}: ${decodeURIComponent(pageAccount)}`);
  }

  function render() {
    list.replaceChildren(...accounts.map((path) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = decodeURIComponent(path);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${label.textContent}`);
      remove.addEventListener("click", () => {
        save(path, false, remove);
      });
      item.append(label, remove);
      return item;
    }));
  }

  async function save(path, allowed, retryControl) {
    if (controls.disabled) return;
    controls.disabled = true;
    renderPageButton();
    try {
      accounts = await changeAllowedAccount(api, path, allowed);
      render();
      status.textContent = allowed ? "Account added." : "Account removed.";
      notifyActiveTab();
    } catch (e) {
      status.textContent = "Could not save your allowed accounts. Try again.";
      console.error("[LinkedIn Focus] allowed accounts update failed", e);
      return false;
    } finally {
      controls.disabled = false;
      renderPageButton();
      (retryControl.isConnected && !retryControl.disabled ? retryControl : input).focus();
    }
    return true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (controls.disabled) return;
    const path = accountPath(input.value);
    if (!path) {
      status.textContent = "Enter a LinkedIn profile or company URL.";
      input.focus();
      return;
    }
    if (accounts.includes(path)) {
      status.textContent = "This account is already allowed.";
      input.focus();
      return;
    }
    if (await save(path, true, input)) input.value = "";
  });
  pageButton.addEventListener("click", () => {
    if (pageAccount) save(pageAccount, true, pageButton);
  });
  input.addEventListener("input", () => { status.textContent = ""; });
  render();
  controls.disabled = false;
  messageActiveTab(GET_PAGE_ACCOUNT).then((path) => {
    pageAccount = accountPath(path);
    renderPageButton();
  }).catch(() => {
    // The active tab may be outside LinkedIn or awaiting site access.
  });
}

async function init() {
  const state = await api.storage.local.get(SETTINGS_DEFAULTS);
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    let savedValue = coerce(key, state[key]);
    el.checked = savedValue;
    el.addEventListener("change", async () => {
      const value = el.checked;
      el.disabled = true;
      try {
        await api.storage.local.set({ [key]: value });
        savedValue = value;
      } catch (e) {
        el.checked = savedValue;
        console.error("[LinkedIn Focus] popup update failed", e);
        return;
      } finally {
        el.disabled = false;
      }
      notifyActiveTab();
    });
    el.disabled = false;
  }
  initAllowedAccounts(state.allowedAccounts);
}

// Localization is cosmetic, wiring the toggles is not: a broken i18n API must
// not stop init() from running.
try {
  localize();
} catch (e) {
  console.error("[LinkedIn Focus] popup localization failed", e);
}

init().catch((e) => console.error("[LinkedIn Focus] popup init failed", e));
