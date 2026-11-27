// Read one decision prefill. The example predicts a standalone reply, as in the pilot.
import * as ort from "onnxruntime-web/webgpu";
import * as tjs from "@huggingface/transformers";
import { S1S2 } from "./lib/index.js";

const $ = (id) => document.getElementById(id);
const status = (message) => { $("status").textContent = message; };
const QUESTION = { name: "q", type: "predicate", instructions: "Will your answer refuse to do what this request asks?" };
let model = null;
let loaded = "";

ort.env.wasm.wasmPaths = new URL(document.body.dataset.ortBase ?? "./vendor/ort/", location.href).href;

async function load(url) {
  if (model && loaded === url.href) return model;
  await model?.dispose();
  model = null;

  const local = url.href === new URL("./model/manifest.json", location.href).href;
  let options = {};
  if (local) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const manifest = await response.json();
    const base = new URL(".", url).href;
    const repos = [manifest.tokenizer.repo, ...Object.values(manifest.builds).map((b) => b.repo)];
    if (manifest.forecast?.head.repo) repos.push(manifest.forecast.head.repo);
    // serve.mjs verifies the files before making this endpoint available.
    options = { manifest, baseUrls: Object.fromEntries(repos.map((repo) => [repo, base])), allowUnverified: true };
  }

  const next = await S1S2.load({ manifest: url.href, ...options, modules: { ort, transformers: tjs }, device: "webgpu", cpuFallback: false, onStatus: status });
  try {
    if (next.forecastUnavailable) throw new Error(next.forecastUnavailable);
    $("beh").replaceChildren(...next.forecastBehaviors.map((name) => new Option(name, name)));
  } catch (error) {
    await next.dispose();
    throw error;
  }
  model = next;
  loaded = url.href;
  return model;
}

function renderForecast(behaviors) {
  const rows = Object.entries(behaviors).map(([name, value]) => {
    const row = document.createElement("div");
    row.className = "b";
    const label = document.createElement("span");
    label.textContent = name;
    const bar = document.createElement("progress");
    bar.max = 1;
    bar.value = value.p;
    bar.setAttribute("aria-label", name);
    const number = document.createElement("span");
    number.textContent = value.p.toFixed(2);
    row.append(label, bar, number);
    return row;
  });
  $("fc").replaceChildren(...rows);
}

$("run").onclick = async () => {
  $("run").disabled = true;
  $("out").hidden = true;
  try {
    const prompt = $("prompt").value.trim();
    if (!prompt) throw new Error("Enter a prompt.");
    const threshold = $("thr").valueAsNumber;
    if (!$("thr").checkValidity()) throw new Error("Use a threshold between 0 and 1.");
    const m = await load(new URL($("manifest").value, location.href));
    status("Reading the decision prefill…");
    const { forecast, session } = await m.forecast({ input: prompt, questions: [QUESTION] });
    try {
      renderForecast(forecast.behaviors);
      $("cost").textContent = `Layer ${forecast.layer} · ${forecast.cost.extraPrefillTokens} extra prefill tokens`;
      const name = $("beh").value;
      const p = forecast.behaviors[name].p;
      $("out").hidden = false;
      $("gate").textContent = p > threshold
        ? `The estimate exceeds the threshold of ${threshold}. The gate would skip generation.`
        : `The estimate is at or below the threshold of ${threshold}. The gate would allow generation.`;
    } finally {
      await session.dispose();
    }
    status("");
  } catch (error) {
    status(String(error?.message ?? error));
  } finally {
    $("run").disabled = false;
  }
};
