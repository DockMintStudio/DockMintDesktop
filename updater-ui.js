(() => {
  const badge = document.getElementById("updateBadge");
  const action = document.getElementById("updateAction");
  if (!badge || !action || !window.dockmintAPI) return;
  let currentState = { status: "checking" };
  const labels = {
    checking: ["CHECKING", "checking"],
    "up-to-date": ["UP TO DATE", "up-to-date"],
    "out-of-date": ["OUT OF DATE", "out-of-date"],
    downloading: ["DOWNLOADING", "downloading"],
    downloaded: ["UPDATE READY", "downloaded"],
    error: ["UPDATE CHECK FAILED", "error"],
    dev: ["DEV BUILD", "dev"]
  };
  function render(state) {
    currentState = state || currentState;
    const status = currentState.status || "checking";
    const [label, className] = labels[status] || labels.checking;
    badge.textContent = label;
    badge.className = `update-badge ${className}`;
    badge.title = currentState.message || label;
    action.hidden = true;
    action.disabled = false;
    if (status === "out-of-date") { action.hidden = false; action.textContent = "Download latest"; }
    else if (status === "downloading") { action.hidden = false; action.disabled = true; action.textContent = `Downloading ${currentState.progress || 0}%`; }
    else if (status === "downloaded") { action.hidden = false; action.textContent = "Restart to install"; }
    else if (status === "error") { action.hidden = false; action.textContent = "Check again"; }
  }
  action.addEventListener("click", async () => {
    action.disabled = true;
    try {
      if (currentState.status === "out-of-date") {
        const confirmed = window.confirm(`Download DockMint ${currentState.availableVersion || "latest"}? Nothing will install until you choose Restart to install.`);
        if (!confirmed) { action.disabled = false; return; }
        await window.dockmintAPI.downloadUpdate();
      } else if (currentState.status === "downloaded") {
        const confirmed = window.confirm("Restart DockMint now to install the update?");
        if (confirmed) await window.dockmintAPI.installUpdate();
      } else if (currentState.status === "error") {
        render(await window.dockmintAPI.checkForUpdates());
      }
    } catch (error) {
      render({ status: "error", message: "Could not complete the update action." });
    } finally {
      if (currentState.status !== "downloading") action.disabled = false;
    }
  });
  window.dockmintAPI.onUpdateState(render);
  window.dockmintAPI.getUpdateState().then(render).catch(() => render({ status: "error", message: "Update status is unavailable." }));
})();
