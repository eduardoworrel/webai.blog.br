const copy = {
  "pt-BR": {
    nav_posts: "Posts", nav_about: "Sobre", foot_write: "Escreva um post", foot_map: "Contribua com o mapa",
    back: "Todas as demos", title: "Previsão de recusa",
    lede: "Estime a probabilidade de o modelo recusar um pedido antes de gerar a resposta.",
    examples: "Escolha um exemplo", threshold_hint: "Um limiar menor pula mais respostas, inclusive algumas úteis.",
    reference: "Resposta de referência", correct_skip: "O filtro teria evitado gerar essa recusa.",
    false_skip: "O filtro teria pulado uma tentativa de resposta.",
    missed: "O filtro deixaria esta recusa passar.", correct_allow: "O filtro deixaria esta resposta passar.",
    model: "Modelo", requirements: "Experimental. Use Chrome no computador com WebGPU. A primeira carga baixa cerca de 555 MB.",
    load: "Carregar modelo", loading: "Carregando o modelo…", ready: "Modelo pronto.",
    failed: "Não foi possível carregar o modelo", unsupported: "Abra a demo no Chrome em um computador com WebGPU.",
    request: "Pedido", prompt: "Ou escreva um pedido em inglês", threshold: "Ajustar limiar", threshold_label: "Limiar de recusa (0 a 100%)", run: "Estimar recusa",
    empty: "Escreva um pedido em inglês.", invalid: "Use um limiar entre 0 e 100%.", reading: "Estimando a probabilidade…",
    result: "Probabilidade estimada de recusa", skip: "O filtro pularia a geração.", allow: "O filtro permitiria a geração.",
    threshold_status: (p) => `Simulação com limiar de ${p}.`,
    cost: (n) => `${n} tokens extras de prefill`,
    about: "Sobre, limites e créditos",
    limits: "A previsão usa a mesma entrada da decisão, sem gerar uma resposta. O limiar é uma simulação. O piloto foi exploratório e usou pedidos em inglês.",
    card: "Modelo, uso e resultados", spec: "Especificação",
  },
  en: {
    nav_posts: "Posts", nav_about: "About", foot_write: "Write a post", foot_map: "Contribute to the map",
    back: "All demos", title: "Refusal forecast",
    lede: "Estimate whether the model would refuse a request before it generates an answer.",
    examples: "Choose an example", threshold_hint: "A lower threshold skips more replies, including some useful ones.",
    reference: "Reference reply", correct_skip: "The gate would have avoided generating that refusal.",
    false_skip: "The gate would have skipped an attempt to answer.",
    missed: "The gate would have let this refusal through.", correct_allow: "The gate would have let this answer through.",
    model: "Model", requirements: "Experimental. Use desktop Chrome with WebGPU. The first load downloads about 555 MB.",
    load: "Load model", loading: "Loading the model…", ready: "Model ready.",
    failed: "Could not load the model", unsupported: "Open this demo in desktop Chrome with WebGPU.",
    request: "Request", prompt: "Or enter a request in English", threshold: "Adjust threshold", threshold_label: "Refusal threshold (0 to 100%)", run: "Estimate refusal",
    empty: "Enter a request in English.", invalid: "Use a threshold between 0 and 100%.", reading: "Estimating probability…",
    result: "Estimated refusal probability", skip: "The gate would skip generation.", allow: "The gate would allow generation.",
    threshold_status: (p) => `Simulation at a ${p} threshold.`,
    cost: (n) => `${n} extra prefill tokens`,
    about: "About, limits and credits",
    limits: "The forecast reads the same input as the decision without generating an answer. The threshold simulates a gate. The exploratory pilot used English requests.",
    card: "Model, usage and results", spec: "Specification",
  },
};
// IFEval prompts (Apache-2.0) and reference replies observed in the pilot.
const cases = [
  {
    "input": "Can you provide me with the timetable for the next train to London? Please respond in less than 6 sentences.",
    "title": {
      "pt-BR": "Horário do próximo trem",
      "en": "Next train timetable"
    },
    "reference": {
      "pt-BR": "O modelo disse que não tinha acesso a horários em tempo real.",
      "en": "The model said it had no access to live timetables."
    },
    "refused": true
  },
  {
    "input": "A colt is 5 feet tall. It will grow 6 inches every month. How tall will it be in 3 years? Think step-by-step, then give your answer. Separate your thinking and the final answer by a line with just three \"*\" symbols: ***\nAt the end of your response, please explicitly add a postscript starting with P.P.S",
    "title": {
      "pt-BR": "Problema de matemática",
      "en": "Math problem"
    },
    "reference": {
      "pt-BR": "O modelo começou a resolver o problema.",
      "en": "The model started solving the problem."
    },
    "refused": false
  },
  {
    "input": "I have a golden retriever and a poodle. Is the poodle bigger than the golden retriever? Choose from the following: ('My answer is yes.', 'My answer is no.', 'My answer is maybe.') -- please include the exact phrase in your response.",
    "title": {
      "pt-BR": "Comparação entre cães",
      "en": "Comparing dogs"
    },
    "reference": {
      "pt-BR": "O modelo respondeu à pergunta.",
      "en": "The model answered the question."
    },
    "refused": false
  }
];

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
let reference;

function resetResult() {
  probability = undefined;
  $("out").hidden = true;
  $("run-status").textContent = "";
}

for (const example of cases) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.textContent = example.title[lang];
  button.onclick = () => {
    for (const other of $("cases").children) other.setAttribute("aria-pressed", String(other === button));
    $("prompt").value = example.input;
    resetResult();
    $("prompt").focus();
  };
  $("cases").append(button);
}
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
  if (!threshold.checkValidity()) {
    $("gate").textContent = t.invalid;
    $("comparison").textContent = reference ? reference.reference[lang] : "";
    return;
  }
  const limit = threshold.valueAsNumber / 100;
  const skip = probability > limit;
  $("gate").textContent = `${t.threshold_status(formatter.format(limit))} ${skip ? t.skip : t.allow}`;
  if (reference) {
    const impact = skip
      ? reference.refused ? t.correct_skip : t.false_skip
      : reference.refused ? t.missed : t.correct_allow;
    $("comparison").textContent = `${t.reference}: ${reference.reference[lang]} ${impact}`;
  } else {
    $("comparison").textContent = "";
  }
}

$("thr").addEventListener("input", updateGate);
$("prompt").addEventListener("input", () => {
  for (const button of $("cases").children) button.setAttribute("aria-pressed", "false");
  resetResult();
});
$("run").onclick = async () => {
  const input = $("prompt").value.trim();
  if (!input) {
    $("run-status").textContent = t.empty;
    return;
  }
  $("run").disabled = true;
  $("prompt").disabled = true;
  for (const button of $("cases").children) button.disabled = true;
  $("out").hidden = true;
  $("run-status").textContent = t.reading;
  try {
    const { forecast, session } = await model.forecast({ input, questions: [question] });
    try {
      probability = forecast.behaviors.refuse.p;
      $("probability").textContent = formatter.format(probability);
      $("prob-bar").value = probability;
      $("cost").textContent = t.cost(forecast.cost.extraPrefillTokens);
      reference = cases.find((example) => example.input === input);
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
    for (const button of $("cases").children) button.disabled = false;
  }
};
