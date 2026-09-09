const statusEl = document.getElementById("status");
const taskEl = document.getElementById("task");

document.getElementById("run").addEventListener("click", async () => {
  const task = taskEl.value.trim() || "Analyze the screen and suggest the next action.";
  statusEl.textContent = "Running pipeline...";

  chrome.runtime.sendMessage({ type: "RUN_AGENT_TASK", task }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = "Error: " + chrome.runtime.lastError.message;
      return;
    }
    if (!response.ok) {
      statusEl.textContent = "Error: " + response.error;
      return;
    }
    render(response.result);
  });
});

function render(result) {
  const { serverResponse, telemetry } = result;
  const detections = (telemetry.detections || [])
    .map((d) => `<span class="badge">${d.kind} (${(d.confidence * 100).toFixed(0)}%)</span>`)
    .join(" ");

  statusEl.innerHTML = `
    <div><strong>Action:</strong> ${JSON.stringify(serverResponse.action)}</div>
    <div><strong>Reasoning:</strong> ${serverResponse.reasoning || "-"}</div>
    <div style="margin-top:6px"><strong>Redacted regions:</strong> ${detections || "none"}</div>
    <div class="metric" style="margin-top:6px">
      DOM scan: ${telemetry.domScanMs}ms | Capture: ${telemetry.captureMs}ms<br/>
      Redaction: ${telemetry.redactionMs}ms (ViT: ${telemetry.visionModelMs}ms)<br/>
      Server RTT: ${telemetry.serverRoundTripMs}ms | Execute: ${telemetry.executeMs}ms<br/>
      <strong>Total: ${telemetry.totalMs}ms</strong><br/>
      Heap: ${telemetry.resourceStats?.mem ? telemetry.resourceStats.mem.usedJSHeapMB + "MB" : "n/a"} |
      GPU: ${telemetry.resourceStats?.gpu ? "WebGPU" : "WASM"}
    </div>
  `;
}
