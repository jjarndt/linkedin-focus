const api = globalThis.browser ?? globalThis.chrome;

// Popup and feed buttons share a single writer so overlapping edits merge
// against the latest stored list, including edits from different tabs.
let writes = Promise.resolve();

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== CHANGE_ACCOUNT_LIST) return;
  const { list, include } = message;
  const path = accountPath(message.path);
  if (!path || typeof list !== "string" || !Object.hasOwn(ACCOUNT_LIST_DEFAULTS, list) || typeof include !== "boolean") {
    sendResponse(null);
    return;
  }

  writes = writes.then(async () => {
    const stored = await api.storage.local.get({ [list]: [] });
    const accounts = normalizeAccounts(stored[list]);
    if (accounts.includes(path) === include) return accounts;

    const next = include ? [...accounts, path] : accounts.filter((entry) => entry !== path);
    await api.storage.local.set({ [list]: next });
    return next;
  }).then(sendResponse, () => sendResponse(null)).catch(() => {
    // The tab or popup may have closed before the response arrived.
  });
  return true;
});
