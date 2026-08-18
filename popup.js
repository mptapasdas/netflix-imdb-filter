const thEl = document.getElementById("threshold");
const thVal = document.getElementById("thVal");
const statusEl = document.getElementById("status");
const modeButtons = [document.getElementById("modeDim"), document.getElementById("modeHide")];
let displayMode = "dim";

thEl.addEventListener("input", () => {
  thVal.textContent = parseFloat(thEl.value).toFixed(1);
});

function setMode(mode) {
  displayMode = mode;
  modeButtons.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}

modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

chrome.storage.local.get(["threshold", "displayMode"], (s) => {
  const t = s.threshold ?? 7;
  thEl.value = t;
  thVal.textContent = parseFloat(t).toFixed(1);
  setMode(s.displayMode || "dim");
});

const DAILY_LIMIT = 100000;
const usageEl = document.getElementById("usage");
const usageCountEl = document.getElementById("usageCount");
const usageFillEl = document.getElementById("usageFill");

function refreshUsage() {
  chrome.runtime.sendMessage({ type: "getRequestCount" }, (r) => {
    if (!r) return;
    const pct = Math.min(100, (r.count / DAILY_LIMIT) * 100);
    usageCountEl.textContent = r.count;
    usageFillEl.style.width = `${pct}%`;
    usageEl.classList.toggle("warn", pct >= 70 && pct < 90);
    usageEl.classList.toggle("danger", pct >= 90);
  });
}

refreshUsage();
setInterval(refreshUsage, 2000);

document.getElementById("save").addEventListener("click", () => {
  const threshold = parseFloat(thEl.value);
  chrome.storage.local.set({ threshold, displayMode }, () => {
    statusEl.textContent = "Saved — reload Netflix to apply.";
    statusEl.classList.add("show");
    setTimeout(() => statusEl.classList.remove("show"), 2200);
  });
});
