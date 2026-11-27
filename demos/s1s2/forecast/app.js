const copy = {
  "pt-BR": {
    nav_posts: "Posts", nav_about: "Sobre", foot_write: "Escreva um post", foot_map: "Contribua com o mapa",
    back: "Todas as demos", title: "Previsão de recusa",
    lede: "Estime a probabilidade de o modelo recusar um pedido antes de gerar a resposta.",
    cases_title: "Quando vale pular a geração?",
    cases_intro: "Se o modelo provavelmente vai recusar, o aplicativo pode avisar ou encaminhar o pedido sem gastar tempo gerando uma resposta. Veja três casos medidos com um limiar ilustrativo de 10%.",
    cases_note: "As previsões vieram do teste WebGPU. As respostas de referência foram geradas separadamente no piloto, sem o filtro.",
    use: "Usar este pedido", threshold_hint: "Diminuir o limiar pula mais respostas. Isso pode evitar recusas, mas também cortar respostas úteis.",
    recorded: (p) => `Previsão registrada de recusa: ${p}.`,
    observed: "Na resposta de referência",
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
    cases_title: "When is it worth skipping generation?",
    cases_intro: "If the model is likely to refuse, an app can notify the user or reroute the request without spending time generating a reply. These three measured cases use an illustrative 10% threshold.",
    cases_note: "The forecasts came from the WebGPU test. Reference replies were generated separately in the pilot with the gate off.",
    use: "Use this request", threshold_hint: "A lower threshold skips more replies. It can avoid refusals and also cut off useful answers.",
    recorded: (p) => `Recorded refusal forecast: ${p}.`,
    observed: "In the reference reply",
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
// IFEval prompts (Apache-2.0). Scores and reference replies come from the pilot and the Chrome smoke test.
const cases = [
  {
    "input": "Can you provide me with the timetable for the next train to London? Please respond in less than 6 sentences.",
    "p": 0.12843,
    "title": {
      "pt-BR": "Horário do próximo trem",
      "en": "Next train timetable"
    },
    "outcome": {
      "pt-BR": "Pular teria evitado gerar essa recusa.",
      "en": "Skipping would have avoided generating that refusal."
    },
    "reference": {
      "pt-BR": "O modelo disse que não tinha acesso a horários em tempo real.",
      "en": "The model said it had no access to live timetables."
    }
  },
  {
    "input": "A colt is 5 feet tall. It will grow 6 inches every month. How tall will it be in 3 years? Think step-by-step, then give your answer. Separate your thinking and the final answer by a line with just three \"*\" symbols: ***\nAt the end of your response, please explicitly add a postscript starting with P.P.S",
    "p": 0.15881,
    "title": {
      "pt-BR": "Problema de matemática",
      "en": "Math problem"
    },
    "outcome": {
      "pt-BR": "O filtro teria pulado uma tentativa útil.",
      "en": "The gate would have skipped a useful attempt."
    },
    "reference": {
      "pt-BR": "O modelo começou a resolver o problema.",
      "en": "The model started solving the problem."
    }
  },
  {
    "input": "I have a golden retriever and a poodle. Is the poodle bigger than the golden retriever? Choose from the following: ('My answer is yes.', 'My answer is no.', 'My answer is maybe.') -- please include the exact phrase in your response.",
    "p": 0.04349,
    "title": {
      "pt-BR": "Comparação entre cães",
      "en": "Comparing dogs"
    },
    "outcome": {
      "pt-BR": "O filtro teria deixado essa resposta passar.",
      "en": "The gate would have allowed that reply."
    },
    "reference": {
      "pt-BR": "O modelo respondeu à pergunta.",
      "en": "The model answered the question."
    }
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

for (const example of cases) {
  const item = document.createElement("li");
  const title = document.createElement("strong");
  title.textContent = example.title[lang];
  const recorded = document.createElement("p");
  const decision = example.p > 0.1 ? t.skip : t.allow;
  recorded.textContent = `${t.recorded(formatter.format(example.p))} ${decision}`;
  const observed = document.createElement("p");
  observed.className = "fraco";
  observed.textContent = `${example.reference[lang]} ${example.outcome[lang]}`;
  const use = document.createElement("button");
  use.type = "button";
  use.textContent = t.use;
  use.onclick = () => {
    $("prompt").value = example.input;
    $("thr").value = "0.1";
    $("out").hidden = true;
    $("run-status").textContent = "";
    if (model) $("prompt").focus();
    else $("load").focus();
  };
  item.append(title, recorded, observed, use);
  $("cases").append(item);
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
      const reference = cases.find((example) => example.input === input);
      $("comparison").textContent = reference ? `${t.observed}: ${reference.reference[lang]}` : "";
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
