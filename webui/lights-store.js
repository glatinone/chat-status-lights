// Chat Status Lights: one colored dot per sidebar chat row.
// Priority: blue (running) > red (error) > yellow (pending approval) > green (finished, unseen).

import { createStore } from "/js/AlpineStore.js";
import { store as chatsStore } from "/components/sidebar/chats/chats-store.js";
import { sendJsonData } from "/index.js";

const UNSEEN_KEY = "chat_status_lights_unseen";
const APPROVALS_URL = "/api/plugins/human_approval_gate/approvals";
const STATUS_URL = "/api/plugins/chat_status_lights/status";
const APPROVAL_POLL_MS = 3000;
const ERROR_POLL_MS = 8000;

const model = {
  _mounted: false,
  _observer: null,
  _syncScheduled: false,
  _patched: false,
  _selectionWatcher: false,
  _previousRunning: {},
  _finishedUnseen: {},
  _approvalIds: {},
  _errorIds: {},
  _approvalTimer: null,
  _errorTimer: null,

  mount() {
    if (this._mounted) { this._scheduleSync(); return; }
    this._mounted = true;
    this._restoreUnseen();
    this._patchApplyContexts();
    this._watchSelection();
    this._observer = new MutationObserver(() => this._scheduleSync());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._initPreviousRunning();
    this._scheduleSync();
    this._pollApprovals();
    this._pollErrors();
    this._approvalTimer = setInterval(() => this._pollApprovals(), APPROVAL_POLL_MS);
    this._errorTimer = setInterval(() => this._pollErrors(), ERROR_POLL_MS);
  },

  cleanup() {
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._approvalTimer) { clearInterval(this._approvalTimer); this._approvalTimer = null; }
    if (this._errorTimer) { clearInterval(this._errorTimer); this._errorTimer = null; }
    this._mounted = false;
    this._syncScheduled = false;
  },

  _restoreUnseen() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(UNSEEN_KEY) || "{}");
      this._finishedUnseen = raw && typeof raw === "object" ? raw : {};
    } catch (_e) {
      this._finishedUnseen = {};
    }
  },

  _persistUnseen() {
    try { sessionStorage.setItem(UNSEEN_KEY, JSON.stringify(this._finishedUnseen)); } catch (_e) { /* no-op */ }
  },

  _patchApplyContexts() {
    if (this._patched || !chatsStore) return;
    const original = chatsStore.applyContexts.bind(chatsStore);
    const self = this;
    chatsStore.applyContexts = function (contextsList) {
      original(contextsList);
      self._detectTransitions(Array.isArray(contextsList) ? contextsList : []);
      self._scheduleSync();
    };
    this._patched = true;
  },

  _detectTransitions(contexts) {
    const prev = this._previousRunning;
    const newPrev = {};
    const selected = chatsStore.selected;
    let changed = false;
    for (const ctx of contexts) {
      const was = !!prev[ctx.id];
      const is = !!ctx.running;
      newPrev[ctx.id] = is;
      if (was && !is) {
        changed = true;
        if (ctx.id !== selected) this._finishedUnseen[ctx.id] = true;
        setTimeout(() => this._pollErrors(), 400);
      }
      if (is) {
        if (this._finishedUnseen[ctx.id]) { delete this._finishedUnseen[ctx.id]; changed = true; }
        if (this._errorIds[ctx.id]) { delete this._errorIds[ctx.id]; changed = true; }
      }
    }
    this._previousRunning = newPrev;
    this._persistUnseen();
    if (changed) this._scheduleSync();
  },

  _watchSelection() {
    if (this._selectionWatcher) return;
    this._selectionWatcher = true;
    const originalSelect = chatsStore.selectChat.bind(chatsStore);
    const self = this;
    chatsStore.selectChat = async function (id) {
      await originalSelect(id);
      self._clearUnseen(id);
    };
    if (chatsStore.selected) this._clearUnseen(chatsStore.selected);
  },

  _clearUnseen(id) {
    if (!id || !this._finishedUnseen[id]) return;
    delete this._finishedUnseen[id];
    this._persistUnseen();
    this._scheduleSync();
  },

  async _pollApprovals() {
    try {
      const res = await sendJsonData(APPROVALS_URL, { action: "list" });
      const ids = {};
      for (const rec of (res && res.pending) || []) {
        if (rec && rec.context_id) ids[rec.context_id] = true;
      }
      if (JSON.stringify(ids) !== JSON.stringify(this._approvalIds)) {
        this._approvalIds = ids;
        this._scheduleSync();
      }
    } catch (_e) {
      // Human Approval Gate not installed or disabled: yellow never appears
    }
  },

  async _pollErrors() {
    try {
      const res = await sendJsonData(STATUS_URL, { action: "errors" });
      const errs = (res && res.errors) || {};
      if (JSON.stringify(errs) !== JSON.stringify(this._errorIds)) {
        this._errorIds = errs;
        this._scheduleSync();
      }
    } catch (_e) { /* endpoint unavailable: skip */ }
  },

  _stateFor(id) {
    const ctx = (chatsStore.contexts || []).find((c) => c.id === id);
    if (ctx && ctx.running) return "blue";
    if (this._errorIds[id]) return "red";
    if (this._approvalIds[id]) return "yellow";
    if (this._finishedUnseen[id]) return "green";
    return null;
  },

  _scheduleSync() {
    if (this._syncScheduled) return;
    this._syncScheduled = true;
    globalThis.requestAnimationFrame(() => {
      this._syncScheduled = false;
      this._syncDots();
    });
  },

  _syncDots() {
    const contexts = Array.isArray(chatsStore.contexts) ? chatsStore.contexts : [];
    const idState = new Map();
    for (const ctx of contexts) idState.set(ctx.id, this._stateFor(ctx.id));

    // rows that carry an explicit chat id (project sidebar and friends)
    document.querySelectorAll(".chat-container[data-chat-id]").forEach((row) => {
      this._applyDot(row, idState.get(row.getAttribute("data-chat-id")) || null);
    });

    // main sidebar: map rows by position (top-level list items, then children)
    const list = document.querySelector(".chats-config-list:not(.project-sidebar-list)");
    if (!list) return;
    const topLevel = typeof chatsStore.topLevelContexts === "function" ? chatsStore.topLevelContexts() : contexts;
    list.querySelectorAll(":scope > li.chat-tree-item").forEach((li, i) => {
      const parent = topLevel[i];
      const parentRow = li.querySelector(":scope > .chat-container");
      if (parentRow) this._applyDot(parentRow, parent ? idState.get(parent.id) || null : null);
      const children = parent && typeof chatsStore.childContexts === "function" ? chatsStore.childContexts(parent.id) : [];
      li.querySelectorAll(".chat-child-list .chat-container").forEach((childRow, j) => {
        const child = children[j];
        this._applyDot(childRow, child ? idState.get(child.id) || null : null);
      });
    });
  },

  _applyDot(row, state) {
    let dot = row.querySelector(":scope > .chat-list-button > .csl-dot");
    if (!state) { if (dot) dot.remove(); return; }
    if (!dot) {
      const btn = row.querySelector(":scope > .chat-list-button");
      if (!btn) return;
      dot = document.createElement("span");
      dot.className = "csl-dot";
      const name = btn.querySelector(".chat-name");
      if (name) btn.insertBefore(dot, name);
      else btn.appendChild(dot);
    }
    const cls = "csl-dot csl-" + state + (state === "blue" ? " csl-pulse" : "");
    if (dot.className !== cls) dot.className = cls;
  },
};

export const store = createStore("chatStatusLights", model);
