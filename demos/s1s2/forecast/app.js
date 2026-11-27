const copy = {
  "pt-BR": {
    nav_posts: "Posts", nav_about: "Sobre", foot_write: "Escreva um post", foot_map: "Contribua com o mapa",
    back: "Todas as demos", title: "Previsão de recusa",
    lede: "Estime a probabilidade de o modelo recusar um pedido antes de gerar a resposta.",
    model: "Modelo", requirements: "Experimental. Use Chrome no computador com WebGPU. A primeira carga baixa cerca de 555 MB.",
    load: "Carregar modelo", loading: "Carregando o modelo…", ready: "Modelo pronto.",
    failed: "Não foi possível carregar o modelo", unsupported: "Abra a demo no Chrome em um computador com WebGPU.",
    request: "Pedido", prompt: "Escreva um pedido em inglês", threshold: "Limiar para simular o filtro", run: "Estimar recusa",
    empty: "Escreva um pedido em inglês.", invalid: "Use um limiar entre 0 e 1.", reading: "Estimando a probabilidade…",
    result: "Probabilidade estimada de recusa", skip: "O filtro pularia a geração.", allow: "O filtro permitiria a geração.",
    cost: (n) => `${n} tokens extras de prefill`,
    about: "Sobre, limites e créditos",
    limits: "A previsão usa a mesma entrada da decisão, sem gerar uma resposta. O limiar é uma simulação. O piloto foi exploratório e usou pedidos em inglês.",
    card: "Modelo, uso e resultados", spec: "Especificação",
  },
  en: {
    nav_posts: "Posts", nav_about: "About", foot_write: "Write a post", foot_map: "Contribute to the map",
    back: "All demos", title: "Refusal forecast",
    lede: "Estimate whether the model would refuse a request before it generates an answer.",
    model: "Model", requirements: "Experimental. Use desktop Chrome with WebGPU. The first load downloads about 555 MB.",
    load: "Load model", loading: "Loading the model…", ready: "Model ready.",
    failed: "Could not load the model", unsupported: "Open this demo in desktop Chrome with WebGPU.",
    request: "Request", prompt: "Enter a request in English", threshold: "Threshold for simulating the gate", run: "Estimate refusal",
    empty: "Enter a request in English.", invalid: "Use a threshold between 0 and 1.", reading: "Estimating probability…",
    result: "Estimated refusal probability", skip: "The gate would skip generation.", allow: "The gate would allow generation.",
    cost: (n) => `${n} extra prefill tokens`,
    about: "About, limits and credits",
    limits: "The forecast reads the same input as the decision without generating an answer. The threshold simulates a gate. The exploratory pilot used English requests.",
    card: "Model, usage and results", spec: "Specification",
  },
};
const manifest = "https://huggingface.co/eduardoworrel/Qwen3.5-0.8B-Forecast-Refusal-ONNX-S1S2/resolve/630440abeffa0a128fba936a35c2d0577cdb6838/manifest.json";
const question = { name: "refuse", type: "predicate", instructions: "Will your answer refuse to do what this request asks?" };
const $ = (id) => document.getElementById(id);
const lang = (new URLSearchParams(location.search).get("lang") ?? navigator.language).toLowerCase().startsWith("pt") ? "pt-BR" : "en";
const t = copy[lang];
const formatter = new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 1 });
document.documentElement.lang = lang;
document.title = `${t.title} · webai.blog.br`;
for (const element of document.querySelectorAll("[data-t]")) element.textContent = t[element.dataset.t];
const en = lang === "en";
$("home").href = $("foot-home").href = en ? "/en/" : "/";
document.querySelector("nav a[data-t='nav_posts']").href = $("home").href;
$("about").href = en ? "/en/about.html" : "/sobre.html";
$("back").href = `../?lang=${lang}`;
const toggle = $("trocar");
toggle.lang = toggle.hreflang = en ? "pt-BR" : "en";
toggle.href = `?lang=${toggle.lang}`;
toggle.textContent = en ? "Português" : "English";

let model;
let probability;
$("load").onclick = async () => {
  if (!navigator.gpu) {
    $("status").textContent = t.unsupported;
    return;
  }
  $("load").disabled = true;
  $("status").textContent = t.loading;
  $("loading").hidden = false;
  try {
    const [ort, transformers, { S1S2 }] = await Promise.all([
      import("onnxruntime-web/webgpu"), import("@huggingface/transformers"), import("./lib/index.js"),
    ]);
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
    model = await S1S2.load({ manifest, modules: { ort, transformers }, device: "webgpu", cpuFallback: false });
    $("status").textContent = t.ready;
    $("load").hidden = true;
    $("question").hidden = false;
    $("prompt").focus();
  } catch (error) {
    $("status").textContent = `${t.failed}. ${error.message}`;
  } finally {
    $("loading").hidden = true;
    $("load").disabled = false;
  }
};

function updateGate() {
  if (probability === undefined) return;
  const threshold = $("thr");
  $("gate").textContent = !threshold.checkValidity()
    ? t.invalid
    : probability > threshold.valueAsNumber ? t.skip : t.allow;
}

$("thr").addEventListener("input", updateGate);
$("prompt").addEventListener("input", () => { $("out").hidden = true; });
$("run").onclick = async () => {
  const input = $("prompt").value.trim();
  if (!input || !$("thr").checkValidity()) {
    $("run-status").textContent = input ? t.invalid : t.empty;
    return;
  }
  $("run").disabled = true;
  $("prompt").disabled = true;
  $("out").hidden = true;
  $("run-status").textContent = t.reading;
  try {
    const { forecast, session } = await model.forecast({ input, questions: [question] });
    try {
      probability = forecast.behaviors.refuse.p;
      $("probability").textContent = formatter.format(probability);
      $("prob-bar").value = probability;
      $("cost").textContent = t.cost(forecast.cost.extraPrefillTokens);
      updateGate();
      $("out").hidden = false;
    } finally {
      await session.dispose();
    }
    $("run-status").textContent = "";
  } catch (error) {
    $("run-status").textContent = String(error?.message ?? error);
  } finally {
    $("run").disabled = false;
    $("prompt").disabled = false;
  }
};
