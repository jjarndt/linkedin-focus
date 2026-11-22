const api = globalThis.browser ?? globalThis.chrome;

// Popup and feed buttons share a single writer so overlapping edits merge
// against the latest stored list, including edits from different tabs.
let writes = Promise.resolve();

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== CHANGE_ALLOWED_ACCOUNT) return;
  const path = accountPath(message.path);
  if (!path || typeof message.allowed !== "boolean") {
    sendResponse(null);
    return;
  }

  writes = writes.then(async () => {
    const stored = await api.storage.local.get({ allowedAccounts: [] });
    const accounts = normalizeAllowedAccounts(stored.allowedAccounts);
    if (accounts.includes(path) === message.allowed) return accounts;

    const next = message.allowed ? [...accounts, path] : accounts.filter((entry) => entry !== path);
    await api.storage.local.set({ allowedAccounts: next });
    return next;
  }).then(sendResponse, () => sendResponse(null)).catch(() => {
    // The tab or popup may have closed before the response arrived.
  });
  return true;
});
