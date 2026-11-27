// src/media/types.ts
var MODALITIES = ["text", "audio", "image"];

// src/manifest.ts
var MANIFEST_SCHEMA = "s1s2.manifest/1";
var RUNTIMES = ["genai", "decode-only", "transformers.js", "webllm", "litert"];
var HEAD_ROLES = ["predicate", "choice", "score", "evidence"];
var HEAD_KINDS = ["pointer", "linear", "joint"];
var FORECAST_POOLINGS = ["last", "mean", "bins32"];
var FORECAST_BINS = 32;
var HEX64 = /^[0-9a-f]{64}$/;
var SHA1 = /^[0-9a-f]{40}$/;
var ManifestError = class extends Error {
  constructor(problems) {
    super("manifest invalid:\n  - " + problems.join("\n  - "));
    this.problems = problems;
    this.name = "ManifestError";
  }
  problems;
};
function validateManifest(m) {
  const p = [];
  const need2 = (c, msg) => {
    if (!c) p.push(msg);
  };
  const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const str = (x) => typeof x === "string" && x.length > 0;
  const int = (x) => Number.isInteger(x) && x >= 0;
  const tokenRef = (x, at) => need2(isObj(x) && int(x.id) && typeof x.text === "string" && x.text.length > 0, `${at}: expected {id: int, text: string}`);
  const pinned = (x, at) => {
    if (!isObj(x)) return p.push(`${at}: expected {path, sha256}`);
    need2(
      str(x.path) && (/^https:\/\//.test(x.path) || !x.path.startsWith("/") && !/^[a-z]+:/i.test(x.path)) && !x.path.split("/").includes(".."),
      `${at}.path: repo-relative path or absolute https URL required`
    );
    need2(typeof x.sha256 === "string" && HEX64.test(x.sha256), `${at}.sha256: 64 lowercase hex chars required`);
    if (x.size !== void 0) need2(int(x.size), `${at}.size: non-negative integer`);
  };
  const rev = (x, at) => need2(typeof x === "string" && SHA1.test(x), `${at}: pinned 40-hex commit sha required (not a branch)`);
  if (!isObj(m)) throw new ManifestError(["manifest: expected an object"]);
  if (Array.isArray(m.modalities) && m.modalities.length > 0 && !m.modalities.includes("text"))
    throw new ManifestError(['modalities: this manifest has no "text"; it is a media package: use loadMedia() / validateMediaManifest() from "@s1s2/web/media" (spec/MULTIMODAL.md)']);
  need2(m.schema === MANIFEST_SCHEMA, `schema: unsupported schema id ${JSON.stringify(m.schema)}; expected "${MANIFEST_SCHEMA}"`);
  need2(str(m.id), "id: non-empty string");
  need2(isObj(m.base) && str(m.base?.repo), "base.repo: string");
  rev(m.base?.revision, "base.revision");
  need2(int(m.hiddenSize) && m.hiddenSize > 0, "hiddenSize: positive integer");
  need2(isObj(m.layer) && (m.layer.read === "final" || int(m.layer.read)) && m.layer.norm === "in-graph", 'layer: {read: "final" | layer index, norm: "in-graph"}');
  if (!isObj(m.tokenizer)) p.push("tokenizer: object required");
  else {
    need2(str(m.tokenizer.repo), "tokenizer.repo: string");
    rev(m.tokenizer.revision, "tokenizer.revision");
    pinned(m.tokenizer.files?.tokenizer, "tokenizer.files.tokenizer");
    pinned(m.tokenizer.files?.config, "tokenizer.files.config");
  }
  need2(Array.isArray(m.eos) && m.eos.length > 0, "eos: non-empty array");
  (m.eos ?? []).forEach((t, i) => tokenRef(t, `eos[${i}]`));
  if (m.warmup !== void 0) tokenRef(m.warmup, "warmup");
  const e = m.encoding;
  if (!isObj(e)) p.push("encoding: object required");
  else if (e.kind === "tagged") {
    need2(str(e.template) && e.template.includes("{state}") && e.template.includes("{question}"), "encoding.template: must contain {state} and {question}");
    if (str(e.template)) need2(e.template.indexOf("{state}") < e.template.indexOf("{question}"), "encoding.template: {state} must come before {question} (shared prefix)");
    for (const t of ["predicate", "choice", "score"]) need2(typeof e.question?.[t] === "string", `encoding.question.${t}: string`);
    need2(typeof e.question?.choice === "string" && e.question.choice.includes("{options}"), "encoding.question.choice: must contain {options}");
    need2(str(e.option) && e.option.includes("{label}"), "encoding.option: must contain {label}");
    if (e.forbiddenInLabels !== void 0) need2(Array.isArray(e.forbiddenInLabels) && e.forbiddenInLabels.every(str), "encoding.forbiddenInLabels: string[]");
    if (e.escapeSpecial !== void 0) need2(typeof e.escapeSpecial === "boolean", "encoding.escapeSpecial: boolean");
    if (e.escapeLiterals !== void 0) need2(Array.isArray(e.escapeLiterals) && e.escapeLiterals.every((x) => str(x) && x.trim().length > 1), "encoding.escapeLiterals: string[] (each at least 2 characters after trim)");
  } else if (e.kind === "kev") {
    for (const k of ["state", "question", "optionStart", "optionEnd", "decide"]) tokenRef(e.delimiters?.[k], `encoding.delimiters.${k}`);
    if (e.predicateOptions !== void 0) need2(Array.isArray(e.predicateOptions) && e.predicateOptions.length === 2 && e.predicateOptions.every(str), "encoding.predicateOptions: [no, yes]");
  } else p.push(`encoding.kind: "tagged" or "kev", got ${JSON.stringify(e.kind)}`);
  for (const k of ["decide", "option"]) {
    const mk = m.markers?.[k];
    need2(
      isObj(mk) && str(mk.text) && (mk.at === "last-token" || mk.at === "token") && Array.isArray(mk.tokens) && mk.tokens.length > 0,
      `markers.${k}: {text, tokens: [{id, text}], at: "last-token"|"token"}`
    );
    (Array.isArray(mk?.tokens) ? mk.tokens : []).forEach((t, i) => tokenRef(t, `markers.${k}.tokens[${i}]`));
  }
  const lastMk = m.markers?.last;
  if (lastMk !== void 0) {
    need2(isObj(lastMk) && Array.isArray(lastMk.tokens) && lastMk.tokens.length > 0, "markers.last: {text, tokens, at}");
    (Array.isArray(lastMk?.tokens) ? lastMk.tokens : []).forEach((t, i) => tokenRef(t, `markers.last.tokens[${i}]`));
  }
  if (isObj(e) && e.kind === "kev" && isObj(m.markers?.decide) && isObj(m.markers?.option)) {
    const only = (mk, id) => Array.isArray(mk.tokens) && mk.tokens.length === 1 && mk.tokens[0]?.id === id;
    need2(
      only(m.markers.decide, e.delimiters?.decide?.id) && only(m.markers.option, e.delimiters?.optionEnd?.id),
      "markers: for kev, the decide/option marker tokens must be exactly the decide/optionEnd delimiters"
    );
  }
  need2(
    isObj(m.readout) && ["last", "options"].includes(m.readout.predicate) && m.readout.choice === "option" && ["last", "option"].includes(m.readout.score),
    'readout: {predicate: "last"|"options", choice: "option", score: "last"|"option"}'
  );
  if (m.readout?.score === "option") need2(isObj(e) && e.kind === "kev", 'readout.score "option" requires the kev encoding (levels as options, Kev)');
  if (m.readout?.predicate === "options") need2(isObj(e) && e.kind === "kev", 'readout.predicate "options" requires the kev encoding (predicate as a [no, yes] branch)');
  if (!isObj(m.logits)) p.push("logits: object required");
  else {
    tokenRef(m.logits.predicate?.yes, "logits.predicate.yes");
    tokenRef(m.logits.predicate?.no, "logits.predicate.no");
    if (m.logits.predicate?.yes?.id === m.logits.predicate?.no?.id) p.push("logits.predicate: yes and no must be different tokens");
    const ch = m.logits.choice;
    need2(["first-token", "letters", "tokens"].includes(ch?.map), 'logits.choice.map: "first-token" | "letters" | "tokens"');
    if (ch?.map === "tokens") {
      need2(Array.isArray(ch.tokens) && ch.tokens.length >= 2, "logits.choice.tokens: at least 2 tokens");
      (ch.tokens ?? []).forEach((t, i) => {
        tokenRef(t, `logits.choice.tokens[${i}]`);
        need2(str(t?.label), `logits.choice.tokens[${i}].label: non-empty string`);
      });
      if (Array.isArray(ch.tokens)) {
        need2(new Set(ch.tokens.map((t) => t?.id)).size === ch.tokens.length, "logits.choice.tokens: ids must be distinct");
        need2(new Set(ch.tokens.map((t) => t?.label)).size === ch.tokens.length, "logits.choice.tokens: labels must be distinct");
      }
    } else need2(ch?.tokens === void 0, 'logits.choice.tokens: only with map "tokens"');
    if (m.logits.temperature !== void 0) {
      if (!isObj(m.logits.temperature)) p.push("logits.temperature: { predicate?, choice?, score? } of positive numbers");
      else for (const [t, v] of Object.entries(m.logits.temperature))
        need2(["predicate", "choice", "score"].includes(t) && typeof v === "number" && Number.isFinite(v) && v > 0, `logits.temperature.${t}: positive number for a question type`);
    }
    const sc = m.logits.score;
    need2(["tokens", "first-token"].includes(sc?.map), 'logits.score.map: "tokens" | "first-token"');
    if (sc?.lead !== void 0) need2(typeof sc.lead === "string" && sc.lead.trim() === "", "logits.score.lead: a whitespace-only string");
    if (sc?.map === "tokens") {
      need2(Array.isArray(sc.tokens) && sc.tokens.length >= 2, "logits.score.tokens: at least 2 tokens");
      (sc.tokens ?? []).forEach((t, i) => tokenRef(t, `logits.score.tokens[${i}]`));
      if (Array.isArray(sc.tokens)) need2(new Set(sc.tokens.map((t) => t?.id)).size === sc.tokens.length, "logits.score.tokens: ids must be distinct");
    }
  }
  const d = m.defaults;
  if (!isObj(d)) p.push("defaults: object required");
  else {
    for (const t of ["predicate", "choice", "score"]) need2(["logits", "head"].includes(d.method?.[t]), `defaults.method.${t}: "logits" | "head"`);
    if (d.levels !== void 0) need2(Array.isArray(d.levels) && d.levels.length >= 2 && d.levels.every(str), "defaults.levels: string[] (>= 2)");
    if (m.logits?.score?.map === "tokens" && Array.isArray(d.levels) && Array.isArray(m.logits.score.tokens))
      need2(d.levels.length === m.logits.score.tokens.length, "defaults.levels: count must equal logits.score.tokens");
  }
  const g = m.generation;
  if (!isObj(g)) p.push("generation: object required");
  else {
    need2(str(g.turn) && g.turn.includes("{prompt}"), "generation.turn: must contain {prompt}");
    need2(str(g.continue) && g.continue.includes("{prompt}") && g.continue.includes("{answer}"), "generation.continue: must contain {answer} and {prompt}");
    need2(Array.isArray(g.answers?.predicate) && g.answers.predicate.length === 2, "generation.answers.predicate: [noText, yesText]");
    if (g.escalate !== void 0) need2(str(g.escalate) && g.escalate.includes("{prompt}") && !g.escalate.includes("{answer}"), "generation.escalate: must contain {prompt} and not {answer}");
    if (g.think !== void 0) need2(typeof g.think.on === "string" && typeof g.think.off === "string", "generation.think: {on, off}");
  }
  if (!isObj(m.builds) || !Object.keys(m.builds).length) p.push("builds: at least one build");
  else for (const [name, b] of Object.entries(m.builds)) {
    const at = `builds.${name}`;
    if (!isObj(b)) {
      p.push(`${at}: object`);
      continue;
    }
    need2(RUNTIMES.includes(b.runtime), `${at}.runtime: one of ${RUNTIMES.join(", ")}`);
    need2(str(b.repo), `${at}.repo: string`);
    rev(b.revision, `${at}.revision`);
    if (!isObj(b.files)) p.push(`${at}.files: object`);
    else for (const [role, f] of Object.entries(b.files)) pinned(f, `${at}.files.${role}`);
    const roles = REQUIRED_ROLES[b.runtime] ?? [];
    for (const r of roles) need2(isObj(b.files?.[r]), `${at}.files.${r}: required for runtime ${b.runtime}`);
    if (isObj(b.files?.embeddings)) {
      need2(b.runtime === "genai", `${at}.files.embeddings: only for runtime genai (exclude_embeds builds)`);
      need2(
        int(b.files.embeddings.size) && int(m.hiddenSize) && b.files.embeddings.size % (m.hiddenSize * 2) === 0,
        `${at}.files.embeddings.size: pinned, a multiple of hiddenSize * 2 (fp16 [vocab, hiddenSize])`
      );
    }
    need2(b.hiddenOutput === null || str(b.hiddenOutput), `${at}.hiddenOutput: string or null`);
    need2(Array.isArray(b.devices) && b.devices.length > 0, `${at}.devices: non-empty array`);
    need2(b.fidelity === null || isObj(b.fidelity), `${at}.fidelity: object or null (slot filled by the lab)`);
    if (isObj(b.heads)) for (const [hn, h] of Object.entries(b.heads)) {
      pinned(h?.file, `${at}.heads.${hn}.file`);
      need2(Array.isArray(h?.types) && h.types.length > 0 && h.types.every((t) => HEAD_ROLES.includes(t)), `${at}.heads.${hn}.types: ("predicate" | "choice" | "score" | "evidence")[]`);
      const kind = h?.kind ?? "pointer";
      need2(HEAD_KINDS.includes(kind), `${at}.heads.${hn}.kind: "pointer" | "linear" | "joint"`);
      need2(h?.format === void 0 || h.format === "head.bin" || h.format === "safetensors", `${at}.heads.${hn}.format: "head.bin" | "safetensors"`);
      need2(kind === "pointer" || h?.format !== "head.bin", `${at}.heads.${hn}: head.bin holds pointer heads only`);
      need2(h?.layer === void 0 || h.layer === "final" || Number.isInteger(h.layer) && h.layer >= 0, `${at}.heads.${hn}.layer: "final" | layer index`);
      need2(h?.read === void 0 || h.read === "decide" || h.read === "last", `${at}.heads.${hn}.read: "decide" | "last"`);
      need2(h?.softcap === void 0 || h.softcap === null || typeof h.softcap === "number" && h.softcap > 0, `${at}.heads.${hn}.softcap: positive number | null`);
      if (kind === "joint") need2(isObj(h?.config), `${at}.heads.${hn}.config: the joint head config`);
      if (h?.scale !== void 0) need2(typeof h.scale === "number" && Number.isFinite(h.scale) && h.scale > 0, `${at}.heads.${hn}.scale: positive number`);
    }
    need2(b.forecastOutput === void 0 === (b.forecastLayer === void 0), `${at}: forecastOutput and forecastLayer go together`);
    if (b.forecastOutput !== void 0) {
      need2(str(b.forecastOutput) && int(b.forecastLayer), `${at}: forecastOutput: string, forecastLayer: layer index`);
      need2(["genai", "decode-only", "transformers.js"].includes(b.runtime), `${at}.forecastOutput: runtime ${b.runtime} has no extra graph output (forecast unsupported); only genai, decode-only, transformers.js`);
    }
    need2(b.attention === void 0 || b.attention === "causal" || b.attention === "noncausal", `${at}.attention: "causal" | "noncausal"`);
    if (b.norm !== void 0) {
      if (!isObj(b.norm)) p.push(`${at}.norm: {file, kind?, eps?, weight?}`);
      else {
        pinned(b.norm.file, `${at}.norm.file`);
        need2(b.norm.kind === void 0 || b.norm.kind === "rmsnorm", `${at}.norm.kind: "rmsnorm"`);
        need2(b.norm.eps === void 0 || typeof b.norm.eps === "number" && Number.isFinite(b.norm.eps) && b.norm.eps >= 0, `${at}.norm.eps: number >= 0`);
        need2(b.norm.weight === void 0 || b.norm.weight === "w" || b.norm.weight === "1+w", `${at}.norm.weight: "w" | "1+w"`);
        need2(b.hiddenOutput !== null, `${at}.norm: needs a hiddenOutput`);
      }
    }
    if (isObj(b.heads)) {
      const seen = /* @__PURE__ */ new Map();
      for (const [hn, h] of Object.entries(b.heads)) for (const t of h?.types ?? []) {
        if (seen.has(t)) p.push(`${at}.heads: type ${t} read by both ${seen.get(t)} and ${hn}`);
        seen.set(t, hn);
      }
    }
    if (b.kvHeadDim !== void 0) need2(int(b.kvHeadDim) && b.kvHeadDim > 0, `${at}.kvHeadDim: positive integer`);
    if (b.maxSafeTokens !== void 0) need2(int(b.maxSafeTokens) && b.maxSafeTokens > 0, `${at}.maxSafeTokens: positive integer`);
  }
  if (m.escalation !== void 0) escalationProblems(m.escalation, "escalation", m, p);
  if (isObj(m.builds)) {
    for (const [name, b] of Object.entries(m.builds)) if (isObj(b) && b.escalation !== void 0) escalationProblems(b.escalation, `builds.${name}.escalation`, m, p);
  }
  if (m.evidence !== void 0) {
    if (!isObj(m.evidence)) p.push("evidence: object {instructions, source?}");
    else {
      need2(str(m.evidence.instructions) && m.evidence.instructions.trim().length > 0, "evidence.instructions: non-empty string");
      if (m.evidence.source !== void 0) need2(typeof m.evidence.source === "string", "evidence.source: string");
      if (m.evidence.sentencePrefix !== void 0) need2(typeof m.evidence.sentencePrefix === "string" && !/\n/.test(m.evidence.sentencePrefix), "evidence.sentencePrefix: string without newlines");
    }
  }
  if (m.forecast !== void 0) forecastProblems(m.forecast, m, p);
  if (m.license !== void 0) need2(str(m.license) && m.license.trim().length > 0, "license: non-empty SPDX expression");
  if (m.provenance !== void 0) provenanceProblems(m.provenance, p);
  if (m.modalities !== void 0) need2(Array.isArray(m.modalities) && m.modalities.length > 0 && m.modalities.every((x) => MODALITIES.includes(x)) && new Set(m.modalities).size === m.modalities.length, `modalities: a non-empty list of distinct values among ${MODALITIES.join(", ")}`);
  if (m.audio !== void 0) need2(Array.isArray(m.modalities) && m.modalities.includes("audio"), 'audio: present, but modalities does not list "audio"');
  if (Array.isArray(m.modalities) && m.modalities.includes("audio")) need2(m.audio !== void 0, 'audio: required by modalities "audio"');
  if (m.confidence !== void 0) need2(isObj(m.confidence) && ["C1", "C3", "C4", "C5", "C6", "C7", "tbd-007"].includes(m.confidence.definition), 'confidence.definition: "C1" | "C3" | "C4" | "C5" | "C6" | "C7" | "tbd-007" (spec 5.1)');
  if (m.tasks !== void 0) {
    if (!isObj(m.tasks)) p.push("tasks: object of named tasks");
    else for (const [name, t] of Object.entries(m.tasks)) taskProblems(t, `tasks.${name}`, m, p, tokenRef);
  }
  if (p.length) throw new ManifestError(p);
  return m;
}
function forecastProblems(f, m, p) {
  const at = "forecast";
  const int = (x) => Number.isInteger(x) && x >= 0;
  const num = (x) => typeof x === "number" && Number.isFinite(x);
  if (!isObj_(f)) {
    p.push(`${at}: object`);
    return;
  }
  const known = ["id", "layer", "pooling", "head", "behaviors", "calibration", "trainedOn"];
  for (const k of Object.keys(f)) if (!known.includes(k)) p.push(`${at}.${k}: unknown key (known: ${known.join(", ")})`);
  if (!(typeof f.id === "string" && f.id)) p.push(`${at}.id: non-empty string`);
  if (!int(f.layer)) p.push(`${at}.layer: 0-indexed block index`);
  if (!FORECAST_POOLINGS.includes(f.pooling)) p.push(`${at}.pooling: ${FORECAST_POOLINGS.join(" | ")}`);
  const nb = Array.isArray(f.behaviors) ? f.behaviors.length : 0;
  if (!Array.isArray(f.behaviors) || !nb || !f.behaviors.every((b) => isObj_(b) && typeof b.name === "string" && b.name)) p.push(`${at}.behaviors: non-empty array of {name, description?}`);
  else if (new Set(f.behaviors.map((b) => b.name)).size !== nb) p.push(`${at}.behaviors: names must be unique`);
  const h = f.head;
  if (!isObj_(h)) p.push(`${at}.head: {type, file, dims}`);
  else {
    if (h.type !== "linear" && h.type !== "mlp") p.push(`${at}.head.type: "linear" | "mlp"`);
    const fl = h.file;
    if (!isObj_(fl) || !(typeof fl.path === "string" && fl.path) || !(typeof fl.sha256 === "string" && HEX64.test(fl.sha256))) p.push(`${at}.head.file: {path, sha256 (64 lowercase hex)}`);
    if (h.revision !== void 0 && !(typeof h.revision === "string" && SHA1.test(h.revision))) p.push(`${at}.head.revision: pinned 40-hex commit sha`);
    const d = h.dims;
    if (!isObj_(d) || !int(d.in) || !int(d.out) || d.in < 1 || d.out < 1) p.push(`${at}.head.dims: {in, out[, hidden]} positive integers`);
    else {
      const per2 = f.pooling === "bins32" ? FORECAST_BINS : 1;
      if (int(m?.hiddenSize) && FORECAST_POOLINGS.includes(f.pooling) && d.in !== per2 * m.hiddenSize) p.push(`${at}.head.dims.in: ${d.in} != ${per2} x hiddenSize (${m.hiddenSize}) for pooling ${f.pooling}`);
      if (nb && d.out !== nb) p.push(`${at}.head.dims.out: ${d.out} != behaviors.length (${nb})`);
      if (h.type === "mlp" && !(int(d.hidden) && d.hidden > 0)) p.push(`${at}.head.dims.hidden: required for an mlp head`);
      if (h.type === "linear" && d.hidden !== void 0) p.push(`${at}.head.dims.hidden: only for an mlp head`);
    }
  }
  const per = (x) => num(x) || Array.isArray(x) && x.length === nb && x.every(num);
  const c = f.calibration;
  if (!isObj_(c) || !per(c.temperature) || (Array.isArray(c.temperature) ? c.temperature : [c.temperature]).some((t2) => !(t2 > 0))) p.push(`${at}.calibration.temperature: number > 0, or one per behavior`);
  else if (c.platt !== void 0 && !(isObj_(c.platt) && per(c.platt.a) && per(c.platt.b))) p.push(`${at}.calibration.platt: {a, b} numbers, or one per behavior`);
  const t = f.trainedOn;
  if (!isObj_(t) || !(typeof t.baseId === "string" && t.baseId) || !(typeof t.weightsSha256 === "string" && HEX64.test(t.weightsSha256)) || t.loraSha256 !== void 0 && !(typeof t.loraSha256 === "string" && HEX64.test(t.loraSha256)))
    p.push(`${at}.trainedOn: {baseId, weightsSha256 (64 hex), loraSha256? (64 hex)}`);
  if (isObj_(m?.builds)) {
    for (const [name, b] of Object.entries(m.builds)) if (isObj_(b) && b.forecastLayer !== void 0 && int(f.layer) && b.forecastLayer !== f.layer)
      p.push(`builds.${name}.forecastLayer: ${b.forecastLayer} != forecast.layer (${f.layer})`);
  }
}
var QTYPES = ["predicate", "choice", "score"];
var isObj_ = (x) => !!x && typeof x === "object" && !Array.isArray(x);
function escalationProblems(e, at, m, p) {
  if (!isObj_(e)) {
    p.push(`${at}: object`);
    return;
  }
  const known = ["metric", "below", "to", "prompt", "maxNewTokens", "provisional", "source"];
  for (const k of Object.keys(e)) if (!known.includes(k)) p.push(`${at}.${k}: unknown key (known: ${known.join(", ")})`);
  if (e.below !== void 0) {
    if (!isObj_(e.below)) p.push(`${at}.below: { predicate?, choice?, score? } of numbers`);
    else for (const [t, v] of Object.entries(e.below)) {
      if (!QTYPES.includes(t)) p.push(`${at}.below.${t}: not a question type`);
      else if (typeof v !== "number" || !Number.isFinite(v) || v < 0) p.push(`${at}.below.${t}: finite number >= 0`);
    }
  }
  if (e.to !== void 0) {
    if (e.to === "generate") {
    } else if (isObj_(e.to) && typeof e.to.build === "string" && e.to.build) {
      if (isObj_(m?.builds) && !m.builds[e.to.build]) p.push(`${at}.to.build: unknown build "${e.to.build}"`);
    } else p.push(`${at}.to: "generate" or { build: "<build name>" }`);
  }
  if (e.metric !== void 0 && !["margin", "rawMargin"].includes(e.metric)) p.push(`${at}.metric: "margin" | "rawMargin"`);
  if (e.prompt !== void 0 && (typeof e.prompt !== "string" || !e.prompt.trim())) p.push(`${at}.prompt: non-empty string`);
  if (e.maxNewTokens !== void 0 && !(Number.isInteger(e.maxNewTokens) && e.maxNewTokens > 0)) p.push(`${at}.maxNewTokens: positive integer`);
  if (e.provisional !== void 0 && typeof e.provisional !== "boolean") p.push(`${at}.provisional: boolean`);
  if (e.source !== void 0 && typeof e.source !== "string") p.push(`${at}.source: string`);
}
function provenanceProblems(v, p) {
  const at = "provenance";
  if (!isObj_(v)) {
    p.push(`${at}: object`);
    return;
  }
  const s = (x) => typeof x === "string" && x.length > 0;
  if (!isObj_(v.generator) || !s(v.generator.name) || !s(v.generator.version)) p.push(`${at}.generator: {name, version} strings`);
  if (v.createdAt !== void 0 && !(s(v.createdAt) && !Number.isNaN(Date.parse(v.createdAt)))) p.push(`${at}.createdAt: ISO 8601 date-time`);
  if (v.base !== void 0) {
    if (!isObj_(v.base) || !s(v.base.repo) || !/^[0-9a-f]{40}$/.test(v.base.revision ?? "")) p.push(`${at}.base: {repo, revision (40-hex)}`);
    else if (v.base.license !== void 0 && !s(v.base.license)) p.push(`${at}.base.license: string`);
  }
  if (v.dataset !== void 0) {
    if (!isObj_(v.dataset) || !/^[0-9a-f]{64}$/.test(v.dataset.sha256 ?? "") || !(Number.isInteger(v.dataset.rows) && v.dataset.rows >= 0))
      p.push(`${at}.dataset: {sha256 (64 hex), rows (integer)}`);
  }
  if (v.source !== void 0 && (!isObj_(v.source) || !s(v.source.format))) p.push(`${at}.source: {format: string}`);
  if (v.training !== void 0 && (!isObj_(v.training) || !s(v.training.recipe))) p.push(`${at}.training: {recipe: string}`);
  if (v.builds !== void 0) {
    if (!isObj_(v.builds)) p.push(`${at}.builds: object`);
    else for (const [n, b] of Object.entries(v.builds)) {
      if (!isObj_(b) || !s(b.tool) || !s(b.version)) {
        p.push(`${at}.builds.${n}: {tool, version}`);
        continue;
      }
      if (b.patches !== void 0 && !(Array.isArray(b.patches) && b.patches.every((x) => isObj_(x) && s(x.path) && /^[0-9a-f]{64}$/.test(x.sha256 ?? ""))))
        p.push(`${at}.builds.${n}.patches: [{path, sha256}]`);
      if (b.args !== void 0 && !(Array.isArray(b.args) && b.args.every((x) => typeof x === "string"))) p.push(`${at}.builds.${n}.args: string[]`);
    }
  }
}
function taskProblems(t, at, m, p, tokenRef) {
  if (!isObj_(t)) {
    p.push(`${at}: object`);
    return;
  }
  if (!QTYPES.includes(t.type)) {
    p.push(`${at}.type: "predicate" | "choice" | "score"`);
    return;
  }
  if (typeof t.instructions !== "string" || !t.instructions.trim()) p.push(`${at}.instructions: non-empty string`);
  if (t.method !== void 0 && !["logits", "head"].includes(t.method)) p.push(`${at}.method: "logits" | "head"`);
  if (t.escalation !== void 0) escalationProblems(t.escalation, `${at}.escalation`, m, p);
  const labelsKey = t.type === "choice" ? "choices" : t.type === "score" ? "levels" : null;
  for (const k of ["choices", "levels", "tokens"]) {
    const allowed = k === labelsKey || k === "tokens" && t.type === "predicate";
    if (t[k] !== void 0 && !allowed) p.push(`${at}.${k}: not used by a ${t.type} task`);
  }
  if (t.type === "predicate") {
    if (t.tokens !== void 0) {
      if (!isObj_(t.tokens)) p.push(`${at}.tokens: { yes, no }`);
      else {
        tokenRef(t.tokens.yes, `${at}.tokens.yes`);
        tokenRef(t.tokens.no, `${at}.tokens.no`);
        if (t.tokens.yes?.id === t.tokens.no?.id) p.push(`${at}.tokens: yes and no must be different tokens`);
      }
    }
    return;
  }
  const src = t[labelsKey];
  if (labelsKey === "levels" && src === void 0 && Array.isArray(m?.defaults?.levels)) return;
  if (!Array.isArray(src) || src.length < 2) {
    p.push(`${at}.${labelsKey}: at least 2 labels`);
    return;
  }
  const values = [];
  let pinned = 0;
  src.forEach((l, i) => {
    const v = typeof l === "string" ? l : l?.value;
    if (typeof v !== "string" || !v.trim()) p.push(`${at}.${labelsKey}[${i}]: non-empty string or { value, description?, token? }`);
    else values.push(v);
    if (isObj_(l) && l.description !== void 0 && typeof l.description !== "string") p.push(`${at}.${labelsKey}[${i}].description: string`);
    if (isObj_(l) && l.token !== void 0) {
      pinned++;
      tokenRef(l.token, `${at}.${labelsKey}[${i}].token`);
    }
  });
  if (new Set(values).size !== values.length) p.push(`${at}.${labelsKey}: duplicate labels`);
  if (pinned && pinned !== src.length) p.push(`${at}.${labelsKey}: pin a token for every label or for none`);
  if (pinned === src.length) {
    const ids = src.map((l) => l.token?.id);
    if (new Set(ids).size !== ids.length) p.push(`${at}.${labelsKey}: pinned token ids must be distinct`);
  }
}
var REQUIRED_ROLES = {
  genai: ["model", "data"],
  "decode-only": ["model", "data"],
  "transformers.js": ["model"],
  webllm: ["config"],
  litert: ["manifest", "graph", "weights", "embed"]
};
function headFor(b, t) {
  for (const [name, spec] of Object.entries(b.heads ?? {})) if (spec.types.includes(t)) return { name, spec };
  return null;
}
function fileUrl(repo, revision, path, baseUrl) {
  if (/^https:\/\//.test(path)) return path;
  if (baseUrl) return new URL(path, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/").href;
  return `https://huggingface.co/${repo}/resolve/${revision}/${path}`;
}

// src/files.ts
var SMALL_FILE_LIMIT = 300 * 1024 * 1024;
var nodeImport = (spec) => import(
  /* @vite-ignore */
  spec
);
async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("sha256: WebCrypto (crypto.subtle) is not available in this context");
  const d = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
var IntegrityError = class extends Error {
  constructor(msg) {
    super(msg);
    this.name = "IntegrityError";
  }
};
var Files = class {
  constructor(o) {
    this.o = o;
    this.f = o.fetch ?? ((...a) => fetch(...a));
    this.status = o.onStatus ?? (() => {
    });
  }
  o;
  f;
  status;
  url(repo, revision, p) {
    return fileUrl(repo, revision, p.path, this.o.baseUrls?.[repo]);
  }
  /** Bytes of a pinned file, sha256-verified. */
  async bytes(repo, revision, p) {
    if (this.o.platform === "node") {
      const fs = await nodeImport("node:fs");
      const b2 = fs.readFileSync(await this.local(repo, revision, p));
      return new Uint8Array(b2.buffer, b2.byteOffset, b2.byteLength);
    }
    const url = this.url(repo, revision, p);
    const r = await this.f(url);
    if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    await checkBytes(b, p, url);
    return b;
  }
  async json(repo, revision, p) {
    return JSON.parse(new TextDecoder().decode(await this.bytes(repo, revision, p)));
  }
  /** Browser: URL of a large file after the paths-info check; Node: verified local path. */
  async large(repo, revision, p) {
    if (this.o.platform === "node") return this.local(repo, revision, p);
    const url = this.url(repo, revision, p);
    if (/^https:\/\//.test(p.path) || this.o.baseUrls?.[repo]) {
      if ((p.size ?? Infinity) <= SMALL_FILE_LIMIT) {
        await this.bytes(repo, revision, p);
        return url;
      }
      if (this.o.allowUnverified) {
        this.status(`unverified (allowUnverified): ${url}`);
        return url;
      }
      throw new IntegrityError(`${url}: large file not on the Hugging Face Hub (or size not pinned), so its sha256 cannot be checked without downloading it; pass allowUnverified: true to accept it`);
    }
    await this.pathsInfo(repo, revision, [p]);
    return url;
  }
  /** HF API metadata check: at `revision`, each path has the manifest sha256 (LFS oid) and size. */
  async pathsInfo(repo, revision, ps) {
    const api = `https://huggingface.co/api/models/${repo}/paths-info/${revision}`;
    const r = await this.f(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: ps.map((p) => p.path) }) });
    if (!r.ok) throw new IntegrityError(`${api}: HTTP ${r.status} (revision ${revision} missing?)`);
    const info = await r.json();
    for (const p of ps) {
      const it = info.find((x) => x.path === p.path);
      if (!it) throw new IntegrityError(`${repo}@${revision}: ${p.path} does not exist`);
      const sha = it.lfs?.oid;
      if (!sha) throw new IntegrityError(`${repo}@${revision}: ${p.path} is not an LFS file; its sha256 is not reported, download it as a small file instead`);
      if (sha !== p.sha256) throw new IntegrityError(`${repo}@${revision}: ${p.path} sha256 ${sha} != manifest ${p.sha256}`);
      if (p.size !== void 0 && it.size !== p.size) throw new IntegrityError(`${repo}@${revision}: ${p.path} size ${it.size} != manifest ${p.size}`);
    }
  }
  async cacheDir() {
    if (this.o.cacheDir) return this.o.cacheDir;
    const env = globalThis.process?.env ?? {};
    if (env.S1S2_CACHE) return env.S1S2_CACHE;
    const os = await nodeImport("node:os"), path = await nodeImport("node:path");
    return path.join(env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "s1s2");
  }
  /** Node: verified local path (local dir, cache, or download). */
  async local(repo, revision, p) {
    const fs = await nodeImport("node:fs"), path = await nodeImport("node:path");
    const cache = await this.cacheDir();
    const localDir = this.o.localDirs?.[repo];
    if (localDir) {
      const file = path.resolve(localDir, p.path);
      if (fs.existsSync(file)) {
        await verifyFileOnce(file, p, cache, this.status);
        return file;
      }
    }
    if (/^https:\/\//.test(p.path)) {
      const u = new URL(p.path);
      return this.download(p.path, path.join(cache, "external", u.hostname, ...u.pathname.split("/").filter(Boolean)), p);
    }
    return this.download(this.url(repo, revision, p), path.join(cache, revision, ...repo.split("/"), ...p.path.split("/")), p);
  }
  async download(url, dest, p) {
    const fs = await nodeImport("node:fs"), path = await nodeImport("node:path"), crypto = await nodeImport("node:crypto");
    if (fs.existsSync(dest)) {
      await verifyFileOnce(dest, p, await this.cacheDir(), this.status);
      return dest;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = `${dest}.part-${globalThis.process?.pid ?? 0}`;
    try {
      const r = await this.f(url);
      if (!r.ok || !r.body) throw new Error(`download ${url}: HTTP ${r.status}`);
      const total = Number(r.headers.get("content-length")) || p.size || 0;
      const h = crypto.createHash("sha256"), out = fs.createWriteStream(part);
      let got = 0, shown = -1;
      for await (const chunk of r.body) {
        h.update(chunk);
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
        const pct = total ? Math.floor(100 * got / total / 10) * 10 : -1;
        if (pct !== shown && pct >= 0 && total > 5e7) {
          shown = pct;
          this.status(`downloading ${path.basename(dest)}: ${pct}%`);
        }
      }
      await new Promise((res, rej) => out.end((e) => e ? rej(e) : res()));
      const sha = h.digest("hex");
      if (sha !== p.sha256) throw new IntegrityError(`${url}: sha256 ${sha} != manifest ${p.sha256}`);
      if (p.size !== void 0 && got !== p.size) throw new IntegrityError(`${url}: size ${got} != manifest ${p.size}`);
      fs.renameSync(part, dest);
      await markVerified(dest, p, await this.cacheDir());
    } catch (e) {
      try {
        fs.rmSync(part, { force: true });
      } catch {
      }
      throw e;
    }
    return dest;
  }
};
async function checkBytes(b, p, where) {
  if (p.size !== void 0 && b.byteLength !== p.size) throw new IntegrityError(`${where}: size ${b.byteLength} != manifest ${p.size}`);
  const sha = await sha256Hex(b);
  if (sha !== p.sha256) throw new IntegrityError(`${where}: sha256 ${sha} != manifest ${p.sha256}`);
}
async function markerPath(cache, p) {
  const path = await nodeImport("node:path");
  return path.join(cache, ".verified", p.sha256);
}
async function markVerified(file, p, cache) {
  const fs = await nodeImport("node:fs"), path = await nodeImport("node:path");
  const st = fs.statSync(file), mk = await markerPath(cache, p);
  fs.mkdirSync(path.dirname(mk), { recursive: true });
  const prev = fs.existsSync(mk) ? JSON.parse(fs.readFileSync(mk, "utf8")) : [];
  prev.push({ path: fs.realpathSync(file), size: st.size, mtimeMs: st.mtimeMs });
  fs.writeFileSync(mk, JSON.stringify(prev));
}
async function verifyFileOnce(file, p, cache, status = () => {
}) {
  const fs = await nodeImport("node:fs"), crypto = await nodeImport("node:crypto");
  const st = fs.statSync(file), real = fs.realpathSync(file), mk = await markerPath(cache, p);
  if (p.size !== void 0 && st.size !== p.size) throw new IntegrityError(`${file}: size ${st.size} != manifest ${p.size}`);
  if (fs.existsSync(mk)) {
    const seen = JSON.parse(fs.readFileSync(mk, "utf8"));
    if (seen.some((x) => x.path === real && x.size === st.size && x.mtimeMs === st.mtimeMs)) return;
  }
  if (st.size > 5e7) status(`hashing ${file} (${(st.size / 1e9).toFixed(2)} GB, once)\u2026`);
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 8 << 20 })) h.update(chunk);
  const sha = h.digest("hex");
  if (sha !== p.sha256) throw new IntegrityError(`${file}: sha256 ${sha} != manifest ${p.sha256}`);
  await markVerified(file, p, cache);
}

// src/tok.ts
function wrapTokenizer(t) {
  if (typeof t?.encode !== "function" || typeof t?.decode !== "function") throw new Error("tokenizer: expected encode() and decode()");
  return {
    encode: (text) => Array.from(t.encode(text, { add_special_tokens: false }), (x) => Number(x)),
    decode: (ids, o = {}) => t.decode(ids, { skip_special_tokens: !!o.skipSpecial, clean_up_tokenization_spaces: false })
  };
}
function tokenizerFromJson(tjs, tokenizerJson, tokenizerConfig) {
  const cls = tjs[tokenizerConfig?.tokenizer_class] ?? tjs[String(tokenizerConfig?.tokenizer_class ?? "").replace(/Fast$/, "")] ?? tjs.PreTrainedTokenizer;
  if (typeof cls !== "function") throw new Error("tokenizer: transformers.js module has no PreTrainedTokenizer");
  return wrapTokenizer(new cls(tokenizerJson, tokenizerConfig));
}
function tokenOffsets(tok, text) {
  const ids = tok.encode(text);
  const offsets = [];
  let prev = 0, full = "";
  for (let i = 0; i < ids.length; i++) {
    full = tok.decode(ids.slice(0, i + 1));
    let end = full.length;
    while (end > prev && full.charCodeAt(end - 1) === 65533) end--;
    offsets.push([prev, end]);
    prev = end;
  }
  if (full !== text) throw new Error("tokenOffsets: decode(encode(prompt)) != prompt; character offsets are not reliable for this tokenizer/prompt");
  return { ids, offsets };
}
function tokenAt(offsets, c) {
  const i = offsets.findIndex(([s, e]) => s <= c && c < e);
  if (i < 0) throw new Error(`tokenAt: no token covers character ${c}`);
  return i;
}
function assertTokenRef(tok, ref, what) {
  const got = tok.encode(ref.text);
  if (got.length !== 1 || got[0] !== ref.id)
    throw new Error(`manifest/tokenizer mismatch: ${what} ${JSON.stringify(ref.text)} encodes to [${got.join(",")}], manifest says [${ref.id}]`);
}

// src/encoding.ts
function escapeSpecial(text) {
  return text.replace(/<\|([A-Za-z0-9_]+)\|>/g, "<\xA6$1\xA6>");
}
function fill(template, values) {
  let text = "";
  const spans = {};
  const re = /\{([a-z]+)\}/g;
  let last = 0, mt;
  while (mt = re.exec(template)) {
    const key = mt[1];
    if (!(key in values)) continue;
    text += template.slice(last, mt.index);
    const s = text.length;
    text += values[key];
    if (!spans[key]) spans[key] = [s, text.length];
    last = mt.index + mt[0].length;
  }
  text += template.slice(last);
  return { text, spans };
}
var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function optionKey(i) {
  if (i >= LETTERS.length) throw new Error("letters mapping supports at most 26 options");
  return LETTERS[i];
}
function escapeLiterals(text, literals) {
  let t = text;
  for (const raw of literals) {
    const m = raw.trim();
    if (m && t.includes(m)) t = t.split(m).join("\u2039" + m.slice(1));
  }
  return t;
}
function taggedEscaper(enc) {
  const lits = enc.escapeLiterals ?? [];
  return (s) => escapeLiterals(enc.escapeSpecial ? escapeSpecial(s) : s, lits);
}
function renderTagged(enc, markers, q, state) {
  const esc = taggedEscaper(enc);
  const optT = enc.option, sep = enc.optionSeparator ?? "";
  let options = "";
  const optMarkRel = [];
  const isChoiceLike = q.type === "choice" || q.type === "score" && enc.question.score.includes("{options}");
  if (isChoiceLike) q.texts.forEach((t, i) => {
    if (i) options += sep;
    const o = fill(optT, { label: esc(t), key: optionKey(i), index: String(i + 1) });
    const after = o.text.slice(o.spans.label[1]);
    const k2 = after.indexOf(markers.option.text);
    if (k2 < 0) throw new Error(`encoding: option marker ${JSON.stringify(markers.option.text)} not found after {label} in the option template`);
    optMarkRel.push(options.length + o.spans.label[1] + k2 + markers.option.text.length - 1);
    options += o.text;
  });
  const qt = fill(enc.question[q.type], { instructions: esc(q.instructions), options });
  const optionsAt = qt.spans.options?.[0] ?? 0;
  const full = fill(enc.template, { state: esc(state), question: qt.text });
  const [qs, qe] = full.spans.question;
  const afterQ = full.text.slice(qe);
  const k = afterQ.indexOf(markers.decide.text);
  if (k < 0) throw new Error(`encoding: decide marker ${JSON.stringify(markers.decide.text)} not found after {question} in the template`);
  return {
    text: full.text,
    decideChar: qe + k + markers.decide.text.length - 1,
    optionChars: isChoiceLike ? optMarkRel.map((r) => qs + optionsAt + r) : [],
    questionStart: full.spans.state[1]
  };
}
function checkMarker(ids, pos, mk, what) {
  if (!mk.tokens.some((t) => t.id === ids[pos]))
    throw new Error(`encoding: token at the ${what} read position ${pos} is ${ids[pos]}, manifest marker ${JSON.stringify(mk.text)} accepts ${mk.tokens.map((t) => t.id).join("|")}`);
}
var isPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
function spanLastToken(tok, text, total, a, b, what) {
  const pa = tok.encode(text.slice(0, a)), pb = tok.encode(text.slice(0, b));
  if (!isPrefix(pa, pb) || !isPrefix(pb, total) || pb.length === pa.length)
    throw new Error(`encoding: the ${what} marker (characters ${a}..${b}) does not have a stable token boundary in this prompt (it merges with the neighbouring text)`);
  return pb.length - 1;
}
function offsetsIfInvertible(tok, text, ids) {
  try {
    const t = tokenOffsets(tok, text);
    return isPrefix(t.ids, ids) && t.ids.length === ids.length ? t.offsets : null;
  } catch {
    return null;
  }
}
function encodeTagged(tok, m, q, state) {
  const enc = m.encoding;
  const r = renderTagged(enc, m.markers, q, state);
  const ids = tok.encode(r.text);
  const offs = offsetsIfInvertible(tok, r.text, ids);
  const at = (lastChar, mk, what) => offs ? tokenAt(offs, lastChar) : spanLastToken(tok, r.text, ids, lastChar - mk.text.length + 1, lastChar + 1, what);
  const decide2 = at(r.decideChar, m.markers.decide, "decide");
  checkMarker(ids, decide2, m.markers.decide, "decide");
  const options = r.optionChars.map((c, i) => at(c, m.markers.option, `option ${i}`));
  options.forEach((p, i) => checkMarker(ids, p, m.markers.option, `option ${i}`));
  const last = ids.length - 1;
  if (m.markers.last) checkMarker(ids, last, m.markers.last, "last");
  let prefixLen = 0;
  if (offs) while (prefixLen < offs.length && offs[prefixLen][1] <= r.questionStart) prefixLen++;
  else {
    const pq = tok.encode(r.text.slice(0, r.questionStart));
    while (prefixLen < pq.length && pq[prefixLen] === ids[prefixLen]) prefixLen++;
    if (prefixLen < pq.length && prefixLen > 0) prefixLen--;
  }
  return { ids, decide: decide2, last, options, prefixLen, text: r.text };
}
function encodeKev(tok, m, q, state) {
  const enc = m.encoding, d = enc.delimiters;
  const e = (s) => tok.encode(escapeSpecial(s));
  const ids = [];
  if (enc.prefix) ids.push(...tok.encode(enc.prefix));
  ids.push(d.state.id, ...e(state));
  const prefixLen = ids.length;
  ids.push(d.question.id, ...e(q.instructions));
  const texts = q.type === "predicate" && m.readout.predicate === "options" ? enc.predicateOptions ?? ["no", "yes"] : q.type === "predicate" ? [] : q.texts;
  const options = [];
  for (const t of texts) {
    ids.push(d.optionStart.id, ...e(t), d.optionEnd.id);
    options.push(ids.length - 1);
  }
  ids.push(d.decide.id);
  const decide2 = ids.length - 1;
  if (enc.suffix) ids.push(...tok.encode(enc.suffix));
  const last = ids.length - 1;
  if (m.markers.last) checkMarker(ids, last, m.markers.last, "last");
  return { ids, decide: decide2, last, options, prefixLen };
}
function encodeQuestion(tok, m, q, state) {
  return m.encoding.kind === "kev" ? encodeKev(tok, m, q, state) : encodeTagged(tok, m, q, state);
}
function assertManifestTokens(tok, m) {
  for (const t of m.eos) assertTokenRef(tok, t, "eos");
  if (m.warmup) assertTokenRef(tok, m.warmup, "warmup");
  assertTokenRef(tok, m.logits.predicate.yes, "logits.predicate.yes");
  assertTokenRef(tok, m.logits.predicate.no, "logits.predicate.no");
  for (const t of m.logits.score.tokens ?? []) assertTokenRef(tok, t, "logits.score.tokens");
  for (const t of m.logits.choice.tokens ?? []) assertTokenRef(tok, t, `logits.choice.tokens (${JSON.stringify(t.label)})`);
  if (m.encoding.kind === "kev") for (const [k, t] of Object.entries(m.encoding.delimiters)) assertTokenRef(tok, t, `encoding.delimiters.${k}`);
  for (const t of taskTokens(m)) {
    const d = tok.decode([t.id]);
    if (d !== t.text) throw new Error(`manifest/tokenizer mismatch: ${t.at} token ${t.id} decodes to ${JSON.stringify(d)}, manifest says ${JSON.stringify(t.text)}`);
  }
  for (const k of ["decide", "option", "last"]) {
    const mk = m.markers[k];
    if (!mk) continue;
    if (m.encoding.kind === "kev") for (const t of mk.tokens) assertTokenRef(tok, t, `markers.${k}`);
    else for (const t of mk.tokens) {
      const d = tok.decode([t.id]);
      if (d !== t.text) throw new Error(`manifest/tokenizer mismatch: markers.${k} token ${t.id} decodes to ${JSON.stringify(d)}, manifest says ${JSON.stringify(t.text)}`);
    }
    if (mk.at === "token" && (mk.tokens.length !== 1 || mk.tokens[0].text !== mk.text)) throw new Error(`markers.${k}: at "token" needs exactly the token ${JSON.stringify(mk.text)}`);
    if (mk.at === "last-token" && !mk.tokens.some((t) => t.text.includes(mk.text.slice(-1))))
      throw new Error(`markers.${k}: no accepted token contains the marker's last character ${JSON.stringify(mk.text.slice(-1))}`);
  }
  if (m.encoding.kind === "tagged") {
    const probe = (q) => {
      try {
        encodeTagged(tok, m, q, "Probe state.");
      } catch (e) {
        throw new Error(`manifest/tokenizer mismatch (probe prompt, ${q.type}): ${e?.message ?? e}`);
      }
    };
    probe({ name: "probe", type: "choice", instructions: "Probe question?", values: ["a", "b"], texts: ["first", "second"] });
    probe({ name: "probe", type: "predicate", instructions: "Probe question?", values: [], texts: [] });
  }
}
function taskTokens(m) {
  const out = [];
  for (const [n, t] of Object.entries(m.tasks ?? {})) {
    if (t.tokens) out.push({ ...t.tokens.yes, at: `tasks.${n}.tokens.yes` }, { ...t.tokens.no, at: `tasks.${n}.tokens.no` });
    for (const k of ["choices", "levels"]) (t[k] ?? []).forEach((l, i) => {
      if (typeof l !== "string" && l.token) out.push({ ...l.token, at: `tasks.${n}.${k}[${i}].token` });
    });
  }
  return out;
}
function scoreLayout(tok, m, q, context) {
  const sc = m.logits.score, none = { lead: "", labels: q.values };
  if (sc.lead !== void 0) return { lead: sc.lead, labels: q.values };
  if (q.labelIds || q.type !== "score") return none;
  return spaceLayout(tok, q.values, context, sc.map === "first-token");
}
function letterLayout(tok, q, context) {
  return spaceLayout(tok, q.values.map((_, i) => optionKey(i)), context, true);
}
function spaceLayout(tok, labels, context, spaced) {
  const none = { lead: "", labels };
  if (context === void 0 || /\s$/.test(context)) return none;
  const base = tok.encode(context), sp = tok.encode(context + " ");
  const spaceAlone = sp.length === base.length + 1 && isPrefix(base, sp) && tok.decode([sp[base.length]]).trim() === "";
  if (spaceAlone && labels.every((l) => {
    const b = tok.encode(context + " " + l);
    return isPrefix(sp, b) && b.length > sp.length;
  }))
    return { lead: " ", labels };
  if (spaced && labels.every((l) => !/^\s/.test(l))) {
    try {
      const sl = labels.map((l) => " " + l);
      const ids = firstTokens(tok, sl, "score", context);
      if (ids.every((id, i) => tok.decode([id]) === sl[i])) return { lead: "", labels: sl };
    } catch {
    }
  }
  return none;
}
function appendLead(tok, enc, lead) {
  if (!lead) return enc;
  if (enc.text === void 0) return { ...enc, ids: [...enc.ids, ...tok.encode(lead)] };
  const ids = tok.encode(enc.text + lead);
  if (!isPrefix(enc.ids, ids) || ids.length === enc.ids.length) throw new Error(`score readout: lead ${JSON.stringify(lead)} merges with the end of the prompt (unstable token boundary); set logits.score.lead to ""`);
  return { ...enc, ids, text: enc.text + lead };
}
function firstTokens(tok, labels, type, context) {
  const base = context === void 0 ? null : tok.encode(context);
  const ids = labels.map((l) => {
    if (base) {
      const b = tok.encode(context + l);
      if (!isPrefix(base, b)) throw new Error(`logits readout: label ${JSON.stringify(l)} merges with the end of the prompt (unstable token boundary)`);
      if (b.length === base.length) throw new Error(`logits readout: label ${JSON.stringify(l)} encodes to no token after the prompt`);
      return b[base.length];
    }
    const t = tok.encode(l);
    if (!t.length) throw new Error(`logits readout: label ${JSON.stringify(l)} encodes to no token`);
    return t[0];
  });
  const seen = /* @__PURE__ */ new Map();
  ids.forEach((id, i) => {
    if (seen.has(id)) throw new Error(`logits readout (${type}): labels ${JSON.stringify(seen.get(id))} and ${JSON.stringify(labels[i])} start with the same token ${id}; the logits cannot tell them apart. Rename the labels or use method "head".`);
    seen.set(id, labels[i]);
  });
  return ids;
}

// src/readout.ts
function f16ToF32(h) {
  const s = (h & 32768) >> 15, e = (h & 31744) >> 10, f = h & 1023;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s ? -Infinity : Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}
function headScale(meta, declared) {
  const pos = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;
  if (meta.scale !== void 0 && !pos(meta.scale)) throw new Error(`head: header scale ${JSON.stringify(meta.scale)} is not a positive number`);
  const fromHeader = meta.scale !== void 0 ? meta.scale : meta.scale_folded_into_q !== void 0 ? 1 : void 0;
  if (declared !== void 0 && !pos(declared)) throw new Error(`head: manifest scale ${JSON.stringify(declared)} is not a positive number`);
  if (fromHeader !== void 0 && declared !== void 0 && Math.abs(fromHeader - declared) > 1e-12 * Math.max(1, declared))
    throw new Error(`head: header scale ${fromHeader} != manifest scale ${declared}`);
  return fromHeader ?? declared ?? 1 / Math.sqrt(meta.headDim);
}
function headScaleSource(meta, declared) {
  return meta.scale !== void 0 ? "header" : meta.scale_folded_into_q !== void 0 ? "folded-marker" : declared !== void 0 ? "manifest" : "default";
}
function loadHead(buf, declaredScale) {
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jsonLen)));
  if (!Number.isInteger(meta.headDim) || meta.headDim < 1 || !Number.isInteger(meta.hiddenSize) || !Number.isFinite(meta.temperature))
    throw new Error("head: bad metadata " + JSON.stringify(meta));
  const scale = headScale(meta, declaredScale);
  let off = 4 + jsonLen;
  const take = (n) => {
    const avail = Math.floor((buf.byteLength - off) / 2);
    if (n > avail) throw new Error(`head binary too short: needs ${n} fp16, ${avail} available`);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = f16ToF32(dv.getUint16(off + i * 2, true));
    off += n * 2;
    return out;
  };
  const hd = {
    q: take(meta.headDim * meta.hiddenSize),
    qb: take(meta.headDim),
    k: take(meta.headDim * meta.hiddenSize),
    kb: take(meta.headDim),
    headDim: meta.headDim,
    hiddenSize: meta.hiddenSize,
    temperature: meta.temperature,
    scoreOffset: meta.score_offset ?? 0,
    scale
  };
  if (off !== buf.byteLength) throw new Error(`head binary has ${buf.byteLength - off} trailing bytes`);
  return hd;
}
function proj(W, b, x, dim, hidden) {
  const y = new Float32Array(dim);
  for (let d = 0; d < dim; d++) {
    let acc = b[d];
    const row = d * hidden;
    for (let i = 0; i < hidden; i++) acc += W[row + i] * x[i];
    y[d] = acc;
  }
  return y;
}
function headScore(hd, hq, hk) {
  if (hq.length !== hd.hiddenSize || hk.length !== hd.hiddenSize)
    throw new Error(`head: hidden size ${hq.length}/${hk.length} != head hiddenSize ${hd.hiddenSize}`);
  const a = proj(hd.q, hd.qb, hq, hd.headDim, hd.hiddenSize), b = proj(hd.k, hd.kb, hk, hd.headDim, hd.hiddenSize);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s * (hd.scale ?? 1) / hd.temperature + (hd.scoreOffset || 0);
}
var sigmoid = (z) => 1 / (1 + Math.exp(-z));
function softmax(xs) {
  const finite = xs.filter(Number.isFinite);
  if (!finite.length) throw new Error("softmax: no finite value");
  const mx = Math.max(...finite);
  const e = xs.map((x) => Number.isFinite(x) ? Math.exp(x - mx) : 0);
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}
function argmax(xs) {
  let b = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[b]) b = i;
  return b;
}
function topGap(xs) {
  const f = xs.filter(Number.isFinite).sort((a, b) => b - a);
  return f.length < 2 ? null : f[0] - f[1];
}
function predicateFromP(name, p, method, raw) {
  const rm = raw !== void 0 ? Math.abs(raw) : Math.abs(Math.log(p) - Math.log1p(-p));
  return {
    name,
    type: "predicate",
    probability: p,
    confidence: Math.max(p, 1 - p),
    method,
    margin: Math.abs(2 * p - 1),
    rawMargin: Number.isFinite(rm) ? rm : null,
    path: "s1",
    ...raw !== void 0 ? { raw } : {}
  };
}
function choiceFromScores(name, values, scores, method) {
  const probs = softmax(scores);
  const b = argmax(probs);
  return { name, type: "choice", choice: values[b], probabilities: values.map((value, i) => ({ value, probability: probs[i] })), confidence: probs[b], method, margin: topGap(probs), rawMargin: topGap(scores), path: "s1", raw: scores };
}
function scoreFromLogits(name, labels, scores, method = "logits") {
  const probs = softmax(scores);
  const score = probs.reduce((a, p, i) => a + p * i, 0);
  return {
    name,
    type: "score",
    score,
    level: labels[Math.min(labels.length - 1, Math.max(0, Math.round(score)))],
    probabilities: labels.map((label, i) => ({ value: i, label, probability: probs[i] })),
    confidence: Math.max(...probs),
    method,
    margin: topGap(probs),
    rawMargin: topGap(scores),
    path: "s1",
    raw: scores
  };
}
function scoreFromHead(name, labels, raw) {
  const score = sigmoid(raw) * (labels.length - 1);
  return { name, type: "score", score, level: labels[Math.round(score)], probabilities: null, confidence: null, method: "head", margin: null, rawMargin: null, path: "s1", raw };
}
function evidenceFromScores(sentences, scores) {
  if (scores.length !== sentences.length) throw new Error(`evidence: ${scores.length} scores for ${sentences.length} sentences`);
  if (!scores.every(Number.isFinite)) throw new Error("evidence: head score is not finite");
  const probs = softmax(scores);
  const b = argmax(probs);
  return {
    method: "head",
    index: b,
    sentence: sentences[b],
    probability: probs[b],
    probabilities: probs,
    sentences,
    margin: topGap(probs),
    rawMargin: topGap(scores),
    raw: scores
  };
}
function decisionOf(a) {
  if (a.type === "predicate") return a.probability >= 0.5 ? "yes" : "no";
  if (a.type === "choice") return a.choice;
  return a.level;
}

// src/heads/safetensors.ts
function f16(h) {
  const s = (h & 32768) >> 15, e = (h & 31744) >> 10, f = h & 1023;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s ? -Infinity : Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}
function parseSafetensors(buf) {
  const dv = new DataView(buf);
  const n = Number(dv.getBigUint64(0, true));
  if (!(n > 1 && 8 + n <= buf.byteLength)) throw new Error(`safetensors: bad header length ${n}`);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  const base = 8 + n, tensors = {};
  for (const [name, t] of Object.entries(head)) {
    if (name === "__metadata__") continue;
    const [a, b] = t.data_offsets, count = t.shape.reduce((x, y) => x * y, 1);
    if (!(base + b <= buf.byteLength && b >= a)) throw new Error(`safetensors: ${name} outside the file`);
    const out = new Float32Array(count);
    const w = t.dtype === "F64" ? 8 : t.dtype === "F32" ? 4 : t.dtype === "F16" || t.dtype === "BF16" ? 2 : 0;
    if (!w) throw new Error(`safetensors: ${name} dtype ${t.dtype} not supported (F64, F32, F16, BF16)`);
    if (b - a !== count * w) throw new Error(`safetensors: ${name} has ${b - a} bytes for ${count} x ${t.dtype}`);
    const o = base + a;
    let f64;
    if (t.dtype === "F64") {
      f64 = new Float64Array(count);
      for (let i = 0; i < count; i++) {
        f64[i] = dv.getFloat64(o + 8 * i, true);
        out[i] = f64[i];
      }
    } else if (t.dtype === "F32") for (let i = 0; i < count; i++) out[i] = dv.getFloat32(o + 4 * i, true);
    else if (t.dtype === "F16") for (let i = 0; i < count; i++) out[i] = f16(dv.getUint16(o + 2 * i, true));
    else {
      const u = new Uint32Array(1), f = new Float32Array(u.buffer);
      for (let i = 0; i < count; i++) {
        u[0] = dv.getUint16(o + 2 * i, true) << 16;
        out[i] = f[0];
      }
    }
    tensors[name] = { dtype: t.dtype, shape: t.shape, data: out, ...f64 ? { f64 } : {} };
  }
  return { metadata: head.__metadata__ ?? {}, tensors };
}
function need(st, name, shape) {
  const t = st.tensors[name];
  if (!t) throw new Error(`safetensors: missing tensor ${name} (has ${Object.keys(st.tensors).slice(0, 8).join(", ")}\u2026)`);
  if (shape && (t.shape.length !== shape.length || t.shape.some((d, i) => shape[i] >= 0 && d !== shape[i])))
    throw new Error(`safetensors: ${name} has shape [${t.shape}], expected [${shape.map((d) => d < 0 ? "*" : d)}]`);
  return t;
}

// src/heads/pointer.ts
function loadPointerSafetensors(buf, spec = {}) {
  const st = parseSafetensors(buf);
  const q = need(st, "q.weight"), k = need(st, "k.weight");
  if (q.shape.length !== 2 || k.shape.length !== 2 || q.shape[0] !== k.shape[0] || q.shape[1] !== k.shape[1]) throw new Error(`pointer head: q/k shapes [${q.shape}] / [${k.shape}]`);
  const [D, H] = q.shape;
  const md = st.metadata ?? {};
  const num = (x) => x === void 0 ? void 0 : Number(x);
  const scale = spec.scale ?? num(md.scale) ?? 1 / Math.sqrt(D);
  const temperature = spec.temperature ?? num(md.temperature) ?? 1;
  const scoreOffset = spec.scoreOffset ?? num(md.score_offset) ?? 0;
  if (!(scale > 0) || !(temperature > 0) || !Number.isFinite(scoreOffset)) throw new Error(`pointer head: scale ${scale}, temperature ${temperature}, score_offset ${scoreOffset}`);
  const bias = (n) => st.tensors[n] ? need(st, n, [D]).data : new Float32Array(D);
  return { q: q.data, qb: bias("q.bias"), k: k.data, kb: bias("k.bias"), headDim: D, hiddenSize: H, temperature, scoreOffset, scale };
}

// src/heads/linear.ts
function loadLinearHead(buf, spec = {}) {
  const st = parseSafetensors(buf);
  const wn = spec.tensors?.weight ?? "weight", bn = spec.tensors?.bias === void 0 ? "bias" : spec.tensors.bias;
  const W = need(st, wn);
  if (W.shape.length !== 2) throw new Error(`linear head: ${wn} must be [rows, hidden], got [${W.shape}]`);
  const [K, H] = W.shape;
  const b = bn !== null && st.tensors[bn] ? need(st, bn, [K]).data : null;
  if (bn !== null && spec.tensors?.bias && !b) throw new Error(`linear head: bias tensor ${bn} missing`);
  const start = {};
  for (const t of ["predicate", "choice", "score", "evidence"]) {
    const r = spec.rows?.[t] ?? (spec.rows ? void 0 : { start: 0 });
    if (!r) continue;
    const end = r.end ?? K;
    if (!(Number.isInteger(r.start) && r.start >= 0 && Number.isInteger(end) && end > r.start && end <= K)) throw new Error(`linear head: rows.${t} ${JSON.stringify(r)} outside [0, ${K}]`);
    start[t] = { start: r.start, end };
  }
  const c = spec.softcap ?? null;
  if (c !== null && !(c > 0)) throw new Error(`linear head: softcap ${c} must be > 0 or null`);
  for (const [t, v] of Object.entries(spec.temperature ?? {})) if (!(typeof v === "number" && v > 0)) throw new Error(`linear head: temperature.${t} must be > 0`);
  return { kind: "linear", W: W.data, b, rows: K, hiddenSize: H, start, softcap: c, temperature: { ...spec.temperature ?? {} }, read: spec.read ?? "decide" };
}
function linearRaw(hd, h, t, n) {
  if (h.length !== hd.hiddenSize) throw new Error(`linear head: hidden size ${h.length} != ${hd.hiddenSize}`);
  const r = hd.start[t];
  if (!r) throw new Error(`linear head: no rows for question type ${t}`);
  if (n > r.end - r.start) throw new Error(`linear head: a ${t} question with ${n} options, the head scores at most ${r.end - r.start}`);
  const z = [];
  for (let i = 0; i < n; i++) {
    const row = (r.start + i) * hd.hiddenSize;
    let a = hd.b ? hd.b[r.start + i] : 0;
    for (let j = 0; j < hd.hiddenSize; j++) a += hd.W[row + j] * h[j];
    z.push(hd.softcap ? hd.softcap * Math.tanh(a / hd.softcap) : a);
  }
  return z;
}
function linearScores(hd, h, t, n) {
  const T2 = hd.temperature[t] ?? 1;
  return linearRaw(hd, h, t, n).map((z) => z / T2);
}

// src/heads/joint.ts
var JOINT_QUESTION_TYPES = ["noul", "choice", "score"];
function loadJointHead(buf, cfg) {
  const st = parseSafetensors(buf);
  const need2 = ["hidden_norm.weight", "memory_projection.weight", "question_projection.weight", "residual_scorer.3.weight", "joint_logit_scale"];
  for (const n of need2) if (!st.tensors[n]) throw new Error(`joint head: missing tensor ${n}`);
  const H = st.tensors["memory_projection.weight"].shape[1], W = st.tensors["memory_projection.weight"].shape[0];
  if (H !== cfg.hidden_size || W !== cfg.width) throw new Error(`joint head: memory_projection [${W}, ${H}] != config width ${cfg.width} x hidden ${cfg.hidden_size}`);
  if (cfg.width % cfg.heads) throw new Error("joint head: width must be a multiple of heads");
  return { kind: "joint", cfg, t: st.tensors };
}
var erf = (x) => {
  const ax = Math.abs(x);
  if (ax < 2.5) {
    let term = x, sum = x;
    for (let n = 1; n < 200; n++) {
      term *= -x * x / n;
      const add2 = term / (2 * n + 1);
      sum += add2;
      if (Math.abs(add2) < 1e-17 * Math.abs(sum)) break;
    }
    return 2 / Math.sqrt(Math.PI) * sum;
  }
  let f = 0;
  for (let n = 60; n >= 1; n--) f = n / 2 / (ax + f);
  const erfc = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f);
  return x > 0 ? 1 - erfc : erfc - 1;
};
var gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));
function T(h, name) {
  const t = h.t[name];
  if (!t) throw new Error(`joint head: missing tensor ${name}`);
  return t;
}
function linear(W, x, b, rowOffset = 0, rows = W.shape[0]) {
  const n = W.shape[1], y = new Float64Array(rows);
  for (let o = 0; o < rows; o++) {
    let a = b ? b.data[rowOffset + o] : 0;
    const r = (rowOffset + o) * n;
    for (let i = 0; i < n; i++) a += W.data[r + i] * x[i];
    y[o] = a;
  }
  return y;
}
function layerNorm(x, w, b, eps = 1e-5) {
  let m = 0;
  for (const v of x) m += v;
  m /= x.length;
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  s /= x.length;
  const inv = 1 / Math.sqrt(s + eps), y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = (x[i] - m) * inv * w.data[i] + b.data[i];
  return y;
}
var ln = (h, p, x) => layerNorm(x, T(h, p + ".weight"), T(h, p + ".bias"));
var add = (a, b) => {
  const y = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) y[i] = a[i] + b[i];
  return y;
};
var dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
var l2 = (a, eps = 1e-12) => {
  const n = Math.max(Math.sqrt(dot(a, a)), eps);
  return a.map((v) => v / n);
};
function mha(h, p, queries, keys) {
  const W = h.cfg.width, heads = h.cfg.heads, d = W / heads;
  const ip = T(h, p + ".in_proj_weight"), ib = T(h, p + ".in_proj_bias");
  const src = keys ?? queries;
  const Q = queries.map((x) => linear(ip, x, ib, 0, W));
  const K = src.map((x) => linear(ip, x, ib, W, W));
  const V = src.map((x) => linear(ip, x, ib, 2 * W, W));
  const out = Q.map(() => new Float64Array(W));
  const sc = 1 / Math.sqrt(d);
  for (let hh = 0; hh < heads; hh++) {
    const o0 = hh * d;
    for (let qi = 0; qi < Q.length; qi++) {
      const s = K.map((k) => {
        let a = 0;
        for (let j = 0; j < d; j++) a += Q[qi][o0 + j] * k[o0 + j];
        return a * sc;
      });
      const mx = Math.max(...s);
      let z = 0;
      const e = s.map((v) => {
        const x = Math.exp(v - mx);
        z += x;
        return x;
      });
      for (let ki = 0; ki < K.length; ki++) {
        const w = e[ki] / z;
        for (let j = 0; j < d; j++) out[qi][o0 + j] += w * V[ki][o0 + j];
      }
    }
  }
  return out.map((x) => linear(T(h, p + ".out_proj.weight"), x, T(h, p + ".out_proj.bias")));
}
function jointScores(h, hidden, lexicalRows, questions) {
  if (!questions.length) throw new Error("joint head: no questions");
  const n = hidden.length, H = h.cfg.hidden_size, W = h.cfg.width;
  for (const q of questions) {
    if (!(q.type >= 0 && q.type < 3) || !q.options.length) throw new Error("joint head: bad question");
    for (const [a, b] of [q.span, ...q.options]) if (!(0 <= a && a < b && b <= n)) throw new Error(`joint head: span [${a}, ${b}) outside the prompt (${n})`);
  }
  const normalized = hidden.map((x) => {
    if (x.length !== H) throw new Error(`joint head: hidden ${x.length} != ${H}`);
    return ln(h, "hidden_norm", Float64Array.from(x));
  });
  const mean = (rows, [a, b], dim) => {
    const s = new Float64Array(dim);
    for (let i = a; i < b; i++) {
      const r = rows(i);
      for (let j = 0; j < dim; j++) s[j] += r[j];
    }
    return s.map((v) => v / (b - a));
  };
  const memory = normalized.map((x) => linear(T(h, "memory_projection.weight"), x));
  const global = normalized[n - 1];
  const qv = questions.map((q) => mean((i) => normalized[i], q.span, H));
  const owner = [], spans = [];
  questions.forEach((q, qi) => q.options.forEach((s) => {
    owner.push(qi);
    spans.push(s);
  }));
  const oc = spans.map((s) => mean((i) => normalized[i], s, H));
  const lexDim = lexicalRows(spans[0][0]).length;
  const lex = spans.map((s) => mean(lexicalRows, s, lexDim));
  const oqp = qv.map((x) => linear(T(h, "option_question_projection.weight"), x));
  let routed = spans.map((_, o) => add(add(linear(T(h, "option_context_projection.weight"), oc[o]), linear(T(h, "option_lexical_projection.weight"), lex[o])), oqp[owner[o]]));
  for (let l = 0; l < h.cfg.routing_layers; l++) {
    const p = `evidence_layers.${l}`;
    const att = mha(h, p + ".attention", routed.map((x) => ln(h, p + ".query_norm", x)), memory.map((x) => ln(h, p + ".memory_norm", x)));
    routed = routed.map((x, i) => add(x, att[i]));
    routed = routed.map((x) => {
      const a = linear(T(h, p + ".feedforward.0.weight"), ln(h, p + ".feedforward_norm", x), T(h, p + ".feedforward.0.bias")).map(gelu);
      return add(x, linear(T(h, p + ".feedforward.3.weight"), a, T(h, p + ".feedforward.3.bias")));
    });
  }
  const base = qv.map((x) => linear(T(h, "question_projection.weight"), x));
  const scores = routed.map((x, o) => dot(x, base[owner[o]]) / Math.sqrt(W));
  const summaries = questions.map(() => new Float64Array(W));
  questions.forEach((_, qi) => {
    const idx = owner.map((ow, o) => ow === qi ? o : -1).filter((o) => o >= 0);
    const mx = Math.max(...idx.map((o) => scores[o]));
    let z = 0;
    const e = idx.map((o) => {
      const v = Math.exp(scores[o] - mx);
      z += v;
      return v;
    });
    idx.forEach((o, k) => {
      for (let j = 0; j < W; j++) summaries[qi][j] += e[k] / z * routed[o][j];
    });
  });
  const gp = linear(T(h, "global_projection.weight"), global), te = T(h, "type_embedding.weight");
  let fields = questions.map((q, qi) => {
    const s = ln(h, "option_summary_norm", summaries[qi]), y = new Float64Array(W);
    for (let j = 0; j < W; j++) y[j] = base[qi][j] + s[j] + gp[j] + te.data[q.type * W + j];
    return y;
  });
  for (let l = 0; l < h.cfg.layers; l++) {
    const p = `layers.${l}`;
    const sa = mha(h, p + ".self_attn", fields.map((x) => ln(h, p + ".norm1", x)), null);
    fields = fields.map((x, i) => add(x, sa[i]));
    const ca = mha(h, p + ".multihead_attn", fields.map((x) => ln(h, p + ".norm2", x)), memory);
    fields = fields.map((x, i) => add(x, ca[i]));
    fields = fields.map((x) => add(x, linear(T(h, p + ".linear2.weight"), linear(T(h, p + ".linear1.weight"), ln(h, p + ".norm3", x), T(h, p + ".linear1.bias")).map(gelu), T(h, p + ".linear2.bias"))));
  }
  fields = fields.map((x) => ln(h, "field_norm", x));
  const cap = Math.log(100);
  const priorScale = Math.exp(Math.min(T(h, "prior_logit_scale").data[0], cap));
  const jointScale = Math.exp(Math.min(T(h, "joint_logit_scale").data[0], cap));
  const gate = 1 / (1 + Math.exp(-T(h, "residual_gate").data[0]));
  const anchor = qv.map((x) => l2(add(x, global)));
  const out = questions.map(() => []);
  spans.forEach((_, o) => {
    const prior = priorScale * dot(l2(lex[o]), anchor[owner[o]]);
    const opt = ln(h, "option_norm", routed[o]), rep = fields[owner[o]];
    const cos = dot(rep, opt) / Math.max(Math.sqrt(dot(rep, rep)) * Math.sqrt(dot(opt, opt)), 1e-8);
    const feat = new Float64Array(4 * W);
    for (let j = 0; j < W; j++) {
      feat[j] = rep[j];
      feat[W + j] = opt[j];
      feat[2 * W + j] = rep[j] * opt[j];
      feat[3 * W + j] = Math.abs(rep[j] - opt[j]);
    }
    const hid = linear(T(h, "residual_scorer.0.weight"), feat, T(h, "residual_scorer.0.bias")).map(gelu);
    const residual = linear(T(h, "residual_scorer.3.weight"), hid, T(h, "residual_scorer.3.bias"))[0];
    out[owner[o]].push(prior + gate * (jointScale * cos + residual));
  });
  return out;
}
var CLEF_PROMPT = {
  prefix: "<|im_start|>system\nRead the complete state and schema. Decide every field jointly. Each answer must be exactly one of that field's allowed options.<|im_end|>\n<|im_start|>user\nSTATE:\n",
  suffix: "\n<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\nJOINT SCHEMA DECISIONS:",
  schemaHeader: "\n\nSCHEMA FIELDS:\n",
  noulCriteria: { true: "The proposition is true or the answer is yes.", false: "The proposition is false or the answer is no." }
};
function pyJson(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + pyJson(v[k])).join(",") + "}";
}
var render = (v) => typeof v === "string" ? v : pyJson(v);
function jointOptions(q, spec = CLEF_PROMPT) {
  if (q.type === "noul") {
    const c = { ...spec.noulCriteria, ...q.criteria ?? {} };
    return [["true", c.true], ["false", c.false]];
  }
  if (q.type === "choice") return Object.entries(q.criteria).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return q.criteria.map((d, i) => [String(i), d]);
}
function encodeJointSchema(encode, state, questions, spec = CLEF_PROMPT) {
  let schema = encode(spec.schemaHeader);
  const qs = [];
  questions.forEach((q, index) => {
    schema = schema.concat(encode(`
FIELD ${index + 1}
ID: ${q.id}
TYPE: ${q.type}
INSTRUCTION: `));
    const instr = q.instructions === void 0 || q.instructions === null || q.instructions === "" ? q.id : q.instructions;
    const qs0 = schema.length;
    schema = schema.concat(encode(render(instr)));
    const span = [qs0, schema.length];
    schema = schema.concat(encode("\nALLOWED OPTIONS:\n"));
    const options = [];
    jointOptions(q, spec).forEach(([name, desc], oi) => {
      schema = schema.concat(encode(`OPTION ${oi + 1}: `));
      const o0 = schema.length;
      const sem = { option_id: name };
      if (desc !== null && desc !== void 0) sem.description = desc;
      schema = schema.concat(encode(render(sem)));
      options.push([o0, schema.length]);
      schema = schema.concat(encode("\n"));
    });
    schema = schema.concat(encode("END FIELD\n"));
    qs.push({ type: JOINT_QUESTION_TYPES.indexOf(q.type), span, options });
  });
  const prefix = encode(spec.prefix), st = encode(render(state)), suffix = encode(spec.suffix);
  const off = prefix.length + st.length;
  return { ids: [...prefix, ...st, ...schema, ...suffix], questions: qs.map((q) => ({ type: q.type, span: [q.span[0] + off, q.span[1] + off], options: q.options.map(([a, b]) => [a + off, b + off]) })) };
}

// src/heads/index.ts
var isLinear = (h) => h?.kind === "linear";
var isJoint = (h) => h?.kind === "joint";
function loadAnyHead(buf, spec = {}) {
  const kind = spec.kind ?? "pointer";
  if (spec.layer !== void 0 && spec.layer !== "final")
    throw new Error(`head reads layer ${spec.layer}: s1s2 0.1 builds expose the final hidden state only (spec 6.6)`);
  const T2 = spec.temperature;
  if (kind === "pointer") {
    if ((spec.format ?? "head.bin") === "head.bin") return loadHead(buf, spec.scale);
    return loadPointerSafetensors(buf, { scale: spec.scale, temperature: typeof T2 === "number" ? T2 : void 0, scoreOffset: spec.scoreOffset });
  }
  if (kind === "linear") {
    const temperature = typeof T2 === "number" ? { predicate: T2, choice: T2, score: T2, evidence: T2 } : T2;
    return loadLinearHead(buf, { tensors: spec.tensors, rows: spec.rows, softcap: spec.softcap, temperature, read: spec.read });
  }
  return loadJointHead(buf, spec.config);
}

// src/heads/norm.ts
function loadNorm(buf, spec = {}) {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  const H = meta.hiddenSize;
  if (!Number.isInteger(H) || H < 1) throw new Error("norm: bad metadata " + JSON.stringify(meta));
  if (meta.kind !== void 0 && !/rmsnorm/.test(String(meta.kind))) throw new Error(`norm: kind ${JSON.stringify(meta.kind)} is not an RMSNorm`);
  if (buf.byteLength !== 4 + n + 4 * H) throw new Error(`norm: ${buf.byteLength} bytes, expected ${4 + n + 4 * H}`);
  const w = new Float32Array(H);
  for (let i = 0; i < H; i++) w[i] = dv.getFloat32(4 + n + 4 * i, true);
  const eps = spec.eps ?? 0;
  if (!(Number.isFinite(eps) && eps >= 0)) throw new Error(`norm: eps ${eps} must be >= 0`);
  const weight = spec.weight ?? "w";
  if (weight !== "w" && weight !== "1+w") throw new Error(`norm: weight ${JSON.stringify(weight)} must be "w" | "1+w"`);
  return { kind: "rmsnorm", w, eps, weight, hiddenSize: H };
}
function applyNorm(nw, h) {
  if (h.length !== nw.hiddenSize) throw new Error(`norm: hidden size ${h.length} != ${nw.hiddenSize}`);
  let s = 0;
  for (let i = 0; i < h.length; i++) s += h[i] * h[i];
  const inv = 1 / Math.sqrt(s / h.length + nw.eps);
  const o = new Float32Array(h.length);
  const one = nw.weight === "1+w" ? 1 : 0;
  for (let i = 0; i < h.length; i++) o[i] = h[i] * inv * (one + nw.w[i]);
  return o;
}

// src/heads/forecastHead.ts
function loadForecastHead(buf, type, dims, at = "forecast head") {
  let st;
  try {
    st = parseSafetensors(buf);
  } catch (e) {
    throw new Error(`${at}: not a safetensors file: ${e?.message ?? e}`);
  }
  const t = (name, shape) => {
    try {
      return need(st, name, shape).data;
    } catch (e) {
      throw new Error(`${at}: ${e?.message ?? e} (manifest dims ${JSON.stringify(dims)})`);
    }
  };
  const mean = t("mean", [dims.in]), std = t("std", [dims.in]);
  for (let i = 0; i < std.length; i++) if (!(std[i] > 0) || !Number.isFinite(std[i])) throw new Error(`${at}: std[${i}] = ${std[i]} must be a finite number > 0`);
  if (type === "linear") return { type, in: dims.in, out: dims.out, mean, std, w1: t("weight", [dims.out, dims.in]), b1: t("bias", [dims.out]) };
  if (!dims.hidden) throw new Error(`${at}: an mlp head needs dims.hidden`);
  return {
    type,
    in: dims.in,
    out: dims.out,
    hidden: dims.hidden,
    mean,
    std,
    w1: t("w1", [dims.hidden, dims.in]),
    b1: t("b1", [dims.hidden]),
    w2: t("w2", [dims.out, dims.hidden]),
    b2: t("b2", [dims.out])
  };
}
function forecastScores(hd, pooled) {
  if (pooled.length !== hd.in) throw new Error(`forecast head: feature width ${pooled.length} != ${hd.in}`);
  const x = new Float32Array(hd.in);
  for (let i = 0; i < hd.in; i++) x[i] = (pooled[i] - hd.mean[i]) / hd.std[i];
  const dense = (W, b, v, rows, cols, relu) => {
    const o = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      let a = b[r];
      const base = r * cols;
      for (let j = 0; j < cols; j++) a += W[base + j] * v[j];
      o[r] = relu && a < 0 ? 0 : a;
    }
    return o;
  };
  if (hd.type === "linear") return dense(hd.w1, hd.b1, x, hd.out, hd.in, false);
  return dense(hd.w2, hd.b2, dense(hd.w1, hd.b1, x, hd.hidden, hd.in, true), hd.out, hd.hidden, false);
}

// src/forecast.ts
function forecastPositions(pooling, n) {
  if (!(Number.isInteger(n) && n > 0)) throw new Error(`forecast: prompt of ${n} tokens`);
  if (pooling === "last") return [n - 1];
  if (pooling === "bins32" && n < FORECAST_BINS) throw new Error(`forecast: pooling bins32 needs a prompt of at least ${FORECAST_BINS} tokens, got ${n}`);
  return Array.from({ length: n }, (_, i) => i);
}
function poolRows(pooling, rows) {
  if (!rows.length) throw new Error("forecast: no rows to pool");
  const H = rows[0].length;
  for (const r of rows) if (r.length !== H) throw new Error(`forecast: rows of different widths (${r.length} vs ${H})`);
  if (pooling === "last") return rows.length === 1 ? rows[0] : rows[rows.length - 1];
  const meanOf = (a, b, out, off) => {
    for (let j = 0; j < H; j++) {
      let s = 0;
      for (let i = a; i < b; i++) s += rows[i][j];
      out[off + j] = s / (b - a);
    }
  };
  const n = rows.length;
  if (pooling === "mean") {
    const o2 = new Float32Array(H);
    meanOf(0, n, o2, 0);
    return o2;
  }
  if (n < FORECAST_BINS) throw new Error(`forecast: pooling bins32 needs at least ${FORECAST_BINS} tokens, got ${n}`);
  const o = new Float32Array(FORECAST_BINS * H);
  for (let b = 0; b < FORECAST_BINS; b++) meanOf(Math.floor(b * n / FORECAST_BINS), Math.floor((b + 1) * n / FORECAST_BINS), o, b * H);
  return o;
}
var sigmoid2 = (x) => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
var ForecastReader = class _ForecastReader {
  constructor(spec, head) {
    this.spec = spec;
    this.head = head;
  }
  spec;
  head;
  static load(spec, bytes, hiddenSize) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const head = loadForecastHead(buf, spec.head.type, spec.head.dims, `forecast ${spec.id}: head ${spec.head.file.path}`);
    const want = (spec.pooling === "bins32" ? FORECAST_BINS : 1) * hiddenSize;
    if (head.in !== want) throw new Error(`forecast ${spec.id}: head input width ${head.in} != ${want} (pooling ${spec.pooling} x hiddenSize ${hiddenSize})`);
    if (head.out !== spec.behaviors.length) throw new Error(`forecast ${spec.id}: head has ${head.out} outputs for ${spec.behaviors.length} behaviors`);
    return new _ForecastReader(spec, head);
  }
  get positionsFor() {
    return (n) => forecastPositions(this.spec.pooling, n);
  }
  /** Rows of the positions `positionsFor(n)` (in that order) -> behavior probabilities. */
  read(rows, question, prefillTokens) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const z = forecastScores(this.head, poolRows(this.spec.pooling, rows));
    const c = this.spec.calibration;
    const at = (v, k) => Array.isArray(v) ? v[k] : v;
    const behaviors = {};
    this.spec.behaviors.forEach((b, k) => {
      let l = z[k] / at(c.temperature, k);
      if (c.platt) l = at(c.platt.a, k) * l + at(c.platt.b, k);
      if (!Number.isFinite(l)) throw new Error(`forecast ${this.spec.id}: behavior ${b.name} is not finite (check the layer output of this build)`);
      behaviors[b.name] = { p: sigmoid2(l), logit: l };
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return { behaviors, layer: this.spec.layer, pooling: this.spec.pooling, question, cost: { prefillTokens, extraPrefillTokens: 0, headMs: t1 - t0 } };
  }
};

// src/backend.ts
var GENERATE_DEFAULTS = { maxNewTokens: 512, temperature: 0.7, topP: 0.9, topK: 40, repetitionPenalty: 1.1, seed: 0 };
function resolveGenerateOptions(o = {}) {
  const num = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
  const D = GENERATE_DEFAULTS;
  const temperature = num(o.temperature, D.temperature);
  return {
    maxNewTokens: Math.max(0, Math.floor(num(o.maxNewTokens, D.maxNewTokens))),
    temperature,
    topP: num(o.topP, D.topP),
    topK: num(o.topK, D.topK),
    repetitionPenalty: num(o.repetitionPenalty, temperature <= 0 ? 1 : D.repetitionPenalty),
    seed: num(o.seed, D.seed),
    signal: o.signal
  };
}
function canShareState(b) {
  return typeof b.snapshot === "function" && typeof b.prefillFrom === "function" && typeof b.generateFrom === "function";
}
function checkContinuation(name, h, ids, positions) {
  const k = h.ids.length;
  if (ids.length <= k || h.ids.some((x, i) => ids[i] !== x)) throw new Error(`${name}: ids must extend the kept prefix (${k} tokens) by at least one token`);
  for (const p of positions) if (!Number.isInteger(p) || p < k || p >= ids.length) throw new Error(`${name}: position ${p} outside the continuation [${k},${ids.length})`);
  return k;
}
function checkPositions(name, ids, positions) {
  if (!ids.length) throw new Error(`${name}: empty ids`);
  for (const p of positions) if (!Number.isInteger(p) || p < 0 || p >= ids.length) throw new Error(`${name}: position ${p} out of [0,${ids.length})`);
}
function createGate(name) {
  let tail = Promise.resolve();
  let disposed = false;
  let disposing = null;
  const err = () => new Error(`${name}: backend already disposed`);
  const lock = async () => {
    const prev = tail;
    let rel;
    tail = new Promise((r) => {
      rel = r;
    });
    await prev;
    return rel;
  };
  return {
    get disposed() {
      return disposed;
    },
    assertLive() {
      if (disposed) throw err();
    },
    async acquire() {
      if (disposed) throw err();
      return lock();
    },
    dispose(release) {
      if (!disposing) {
        disposed = true;
        disposing = (async () => {
          const rel = await lock();
          try {
            await release();
          } finally {
            rel();
          }
        })();
      }
      return disposing;
    }
  };
}
var gates = /* @__PURE__ */ new WeakMap();
function gateFor(shared, name) {
  let g = gates.get(shared);
  if (!g) {
    g = createGate(name);
    gates.set(shared, g);
  }
  return g;
}

// src/questions.ts
function splitSentences(text) {
  const out = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s)/g;
  let start = 0, m;
  while (m = re.exec(text)) {
    out.push(text.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}
function inputToText(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) throw new Error("decide: input must be a string or an array of messages");
  return input.map((m, i) => {
    if (!m || typeof m !== "object" || typeof m.role !== "string") throw new Error(`decide: input[${i}] must be {role, content}`);
    const body = typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content : []).map((p, j) => {
      if (p?.type === "input_text" || p?.type === "output_text") return String(p.text ?? "");
      if (p?.type === "input_json") return JSON.stringify(p.data);
      throw new Error(`decide: input[${i}].content[${j}]: unsupported part type ${JSON.stringify(p?.type)} (text and JSON only; no images)`);
    }).join("\n");
    return input.length === 1 && m.role === "user" ? body : `${m.role}: ${body}`;
  }).join("\n");
}
var TYPE_ALIAS = { predicate: "predicate", noul: "predicate", choice: "choice", score: "score" };
function fromTask(q, m, at) {
  const t = m.tasks?.[q.task];
  if (!t) throw new Error(`${at}: unknown task ${JSON.stringify(q.task)}${m.tasks ? ` (manifest tasks: ${Object.keys(m.tasks).join(", ")})` : " (this manifest declares no tasks)"}`);
  if (q.type !== void 0 && (TYPE_ALIAS[q.type] ?? q.type) !== t.type) throw new Error(`${at}: type ${JSON.stringify(q.type)} differs from task ${q.task} (${t.type})`);
  if (q.choices !== void 0 || q.levels !== void 0 || q.options !== void 0) throw new Error(`${at}: a task question takes its labels from the manifest task`);
  const lab = (l) => typeof l === "string" ? l : { value: l.value, description: l.description };
  return {
    type: t.type,
    instructions: q.instructions ?? t.instructions,
    method: q.method ?? t.method,
    ...t.type === "choice" ? { choices: t.choices.map(lab) } : {},
    ...t.type === "score" && t.levels ? { levels: t.levels.map((l) => {
      const x = lab(l);
      return typeof x === "string" ? x : { label: x.value, description: x.description };
    }) } : {}
  };
}
function taskLabelIds(t) {
  if (t.type === "predicate") return t.tokens ? [t.tokens.no.id, t.tokens.yes.id] : void 0;
  const src = (t.type === "choice" ? t.choices : t.levels) ?? [];
  const ids = src.map((l) => typeof l === "string" ? void 0 : l.token?.id);
  return ids.length && ids.every((x) => x !== void 0) ? ids : void 0;
}
function questionEntries(qs) {
  if (qs === void 0) return [];
  const obj = (q) => typeof q === "string" ? { task: q } : q;
  const entries = Array.isArray(qs) ? qs.map((q0) => {
    const q = obj(q0);
    return [q?.name ?? (typeof q0 === "string" ? q0 : void 0), q];
  }) : qs && typeof qs === "object" ? Object.entries(qs).map(([k, q0]) => {
    const q = obj(q0);
    if (q?.name !== void 0 && q.name !== k) throw new Error(`decide: question key "${k}" and name "${q.name}" differ`);
    return [k, q];
  }) : [];
  return entries;
}
function normalizeQuestions(qs, m) {
  const entries = questionEntries(qs);
  if (!entries.length) throw new Error("decide: questions must be a non-empty array or object");
  const names = /* @__PURE__ */ new Set();
  return entries.map(([name00, q0], i) => {
    const at = `question ${name00 ?? i}`;
    if (!q0 || typeof q0 !== "object") throw new Error(`${at}: must be an object`);
    const task = q0.task;
    if (task !== void 0 && typeof task !== "string") throw new Error(`${at}: task must be a string`);
    const q = task !== void 0 ? fromTask(q0, m, at) : q0;
    const name0 = name00 ?? task;
    const type = TYPE_ALIAS[q.type];
    if (!type) throw new Error(`${at}: unknown type ${JSON.stringify(q.type)}; use "predicate" (alias "noul"), "choice" or "score"`);
    const name = name0 ?? `q${i}`;
    if (typeof name !== "string" || !name) throw new Error(`${at}: name must be a non-empty string`);
    if (names.has(name)) throw new Error(`decide: duplicate question name "${name}"`);
    names.add(name);
    const instructions = q.instructions ?? m.defaults.instructions?.[type];
    if (typeof instructions !== "string" || !instructions.trim()) throw new Error(`${at}: instructions required (no manifest default for ${type})`);
    if (q.method !== void 0 && !["logits", "head", "both"].includes(q.method)) throw new Error(`${at}: method must be "logits", "head" or "both"`);
    let values = [], texts = [];
    if (type === "choice") {
      if (q.levels !== void 0) throw new Error(`${at}: choice takes choices (or options), not levels`);
      if (q.choices !== void 0 && q.options !== void 0) throw new Error(`${at}: pass choices or options, not both`);
      const src = q.choices ?? q.options ?? [];
      if (!Array.isArray(src) || src.length < 2) throw new Error(`${at}: choice needs at least 2 choices`);
      for (const c of src) {
        const value = typeof c === "string" ? c : c?.value;
        const desc = typeof c === "string" ? q.descriptions?.[c] : c?.description;
        if (typeof value !== "string" || !value.trim()) throw new Error(`${at}: empty or non-string choice ${JSON.stringify(c)}`);
        values.push(value);
        texts.push(desc ? `${value}: ${desc}` : value);
      }
    } else if (type === "score") {
      if (q.choices !== void 0) throw new Error(`${at}: score takes levels (or options), not choices`);
      if (q.levels !== void 0 && q.options !== void 0) throw new Error(`${at}: pass levels or options, not both`);
      const src = q.levels ?? q.options ?? m.defaults.levels ?? [];
      if (!Array.isArray(src) || src.length < 2) throw new Error(`${at}: score needs at least 2 levels (no manifest default)`);
      for (const l of src) {
        const label = typeof l === "string" ? l : l?.label;
        const desc = typeof l === "string" ? void 0 : l?.description;
        if (typeof label !== "string" || !label.trim()) throw new Error(`${at}: empty or non-string level ${JSON.stringify(l)}`);
        values.push(label);
        texts.push(desc ? `${label}: ${desc}` : label);
      }
    } else if (q.choices !== void 0 || q.levels !== void 0 || q.options !== void 0 && q.options.length) {
      throw new Error(`${at}: predicate takes no choices/levels/options`);
    }
    if (new Set(values).size !== values.length) throw new Error(`${at}: duplicate ${type === "score" ? "level" : "choice"} values`);
    const forbidden = m.encoding.kind === "tagged" ? m.encoding.forbiddenInLabels ?? [] : [];
    for (const t2 of texts) for (const f of forbidden) if (t2.includes(f)) throw new Error(`${at}: label ${JSON.stringify(t2)} contains the reserved string ${JSON.stringify(f)}`);
    const t = task !== void 0 ? m.tasks[task] : void 0;
    const labelIds = t ? taskLabelIds(t) : void 0;
    return {
      name,
      type,
      instructions,
      values,
      texts,
      method: q.method,
      ...task !== void 0 ? { task } : {},
      ...labelIds ? { labelIds } : {},
      ...t?.escalation ? { escalation: t.escalation } : {}
    };
  });
}

// src/margin.ts
var PROVISIONAL_NOTE = "provisional - no measured threshold";
var MARGIN_POLICY_DEFAULTS = Object.freeze({
  prompt: "Reconsider the question above step by step, then state your final answer as one of: {options}.",
  maxNewTokens: 256,
  provisional: true,
  source: PROVISIONAL_NOTE
});
function mergePolicy(...levels) {
  const out = { metric: "margin", below: {}, to: null, prompt: MARGIN_POLICY_DEFAULTS.prompt, maxNewTokens: MARGIN_POLICY_DEFAULTS.maxNewTokens, provisional: false, source: "" };
  let anyThreshold = false, provisional = false;
  const sources = [];
  for (const l of levels) {
    if (!l) continue;
    if (l.below && Object.keys(l.below).length) {
      Object.assign(out.below, l.below);
      anyThreshold = true;
      if (l.provisional !== false) provisional = true;
      sources.push(l.source ?? "unspecified");
    }
    if (l.metric !== void 0) out.metric = l.metric;
    if (l.to !== void 0) out.to = l.to;
    if (l.prompt !== void 0) out.prompt = l.prompt;
    if (l.maxNewTokens !== void 0) out.maxNewTokens = l.maxNewTokens;
  }
  out.provisional = anyThreshold ? provisional : MARGIN_POLICY_DEFAULTS.provisional;
  out.source = sources.length ? sources.join(" < ") : MARGIN_POLICY_DEFAULTS.source;
  return out;
}
function manifestPolicy(m, build) {
  return [m.escalation, build ? m.builds[build]?.escalation : void 0].filter(Boolean);
}
function shouldEscalate(a, p) {
  const t = p.below[a.type], v = a[p.metric];
  if (t === void 0 || v === null || v === void 0 || !Number.isFinite(v)) return null;
  return v < t ? { threshold: t, value: v } : null;
}
function thresholdFromQuantile(margins, q) {
  if (!(q > 0 && q < 1)) throw new Error("thresholdFromQuantile: q must be in (0, 1)");
  const xs = margins.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length < 2) throw new Error("thresholdFromQuantile: need at least 2 finite margins");
  const k = Math.floor(q * xs.length);
  return xs[Math.min(k, xs.length - 1)];
}

// src/decide.ts
function logitIds(e, q, ctx, labels = q.values) {
  const m = e.manifest;
  if (q.labelIds) {
    if (q.labelIds.length !== (q.type === "predicate" ? 2 : q.values.length)) throw new Error(`question ${q.name}: task ${q.task} pins ${q.labelIds.length} label tokens for ${q.values.length} labels`);
    return q.labelIds;
  }
  if (q.type === "predicate") return [m.logits.predicate.no.id, m.logits.predicate.yes.id];
  if (q.type === "choice" && m.logits.choice.map === "letters") return firstTokens(e.tok, labels === q.values ? letterLayout(e.tok, q, ctx).labels : labels, "choice", ctx);
  if (q.task !== void 0 && (q.type === "choice" || q.type === "score" && m.tasks?.[q.task]?.levels)) return firstTokens(e.tok, q.type === "score" ? labels : q.values, q.type, ctx);
  if (q.type === "choice") {
    if (m.logits.choice.map === "tokens") {
      const t = m.logits.choice.tokens;
      return q.values.map((v) => {
        const r = t.find((x) => x.label === v);
        if (!r) throw new Error(`question ${q.name}: choice ${JSON.stringify(v)} has no pinned logits token in this manifest (logits.choice.tokens: ${t.map((x) => JSON.stringify(x.label)).join(", ")}); use those labels or method "head"`);
        return r.id;
      });
    }
    return firstTokens(e.tok, q.values, "choice", ctx);
  }
  if (m.logits.score.map === "tokens") {
    const t = m.logits.score.tokens;
    if (t.length !== q.values.length) throw new Error(`question ${q.name}: the logits score readout of this model reads ${t.length} level tokens (${t.map((x) => x.text).join(",")}); got ${q.values.length} levels`);
    return t.map((x) => x.id);
  }
  return firstTokens(e.tok, labels, "score", ctx);
}
function planQuestion(e, q, state, method0) {
  const m = e.manifest;
  const method = q.method ?? method0 ?? m.defaults.method[q.type];
  let enc = encodeQuestion(e.tok, m, q, state);
  const lay = method === "head" ? { lead: "", labels: q.values } : q.type === "score" ? scoreLayout(e.tok, m, q, enc.text) : q.type === "choice" && !q.labelIds && m.logits.choice.map === "letters" ? letterLayout(e.tok, q, enc.text) : { lead: "", labels: q.values };
  enc = appendLead(e.tok, enc, lay.lead);
  if (enc.ids.length > e.maxSafeTokens) throw new Error(`question ${q.name}: prompt has ${enc.ids.length} tokens, over maxSafeTokens (${e.maxSafeTokens})`);
  const ids = method === "head" ? [] : logitIds(e, q, enc.text, lay.labels);
  const fromLogits = (L) => {
    for (const id of ids) if (id >= L.length) throw new Error(`logits readout: token ${id} outside the vocabulary (${L.length})`);
    const T2 = m.logits.temperature?.[q.type] ?? 1;
    if (q.type === "predicate") {
      const raw = (L[ids[1]] - L[ids[0]]) / T2;
      return predicateFromP(q.name, sigmoid(raw), "logits", raw);
    }
    const s = ids.map((i) => L[i] / T2);
    return q.type === "choice" ? choiceFromScores(q.name, q.values, s, "logits") : scoreFromLogits(q.name, q.values, s);
  };
  if (method === "logits") return { q, enc, positions: [], read: (r) => fromLogits(r.lastLogits) };
  if (method !== "head" && method !== "both") throw new Error(`question ${q.name}: unknown method ${JSON.stringify(method)}`);
  if (!e.backend.hiddenName) throw new Error(`question ${q.name}: method "${method}" needs a hidden-state output, which this build does not have; use "logits"`);
  const anyHead = e.heads[q.type];
  if (!anyHead) throw new Error(`question ${q.name}: method "${method}" needs a head for ${q.type}, which this build/manifest does not provide`);
  const withLogits = (a, L) => method === "both" ? { ...a, logits: fromLogits(L) } : a;
  if (isJoint(anyHead)) throw new Error(`question ${q.name}: the ${q.type} head is a joint head (spec 6.4); it reads all questions of one prompt: use jointScores() / encodeJointSchema()`);
  if (isLinear(anyHead)) {
    const n = q.type === "predicate" ? 2 : q.values.length;
    const pos = anyHead.read === "last" ? enc.last : enc.decide;
    return { q, enc, positions: [pos], read: ({ hiddens, lastLogits }) => {
      const z = linearScores(anyHead, hiddens[0], q.type, n);
      if (q.type === "predicate") {
        const c = choiceFromScores(q.name, ["no", "yes"], z, "head");
        return withLogits(predicateFromP(q.name, c.probabilities[1].probability, "head", z[1] - z[0]), lastLogits);
      }
      if (q.type === "choice") return withLogits(choiceFromScores(q.name, q.values, z, "head"), lastLogits);
      return withLogits(scoreFromLogits(q.name, q.values, z, "head"), lastLogits);
    } };
  }
  const hd = anyHead;
  const optionRead = q.type === "choice" || q.type === "predicate" && m.readout.predicate === "options" || q.type === "score" && m.readout.score === "option";
  if (optionRead) {
    if (enc.options.length < 2) throw new Error(`question ${q.name}: head readout found ${enc.options.length} option markers`);
    return { q, enc, positions: [enc.decide, ...enc.options], read: ({ hiddens, lastLogits }) => {
      const scores = hiddens.slice(1).map((h) => headScore(hd, hiddens[0], h));
      if (q.type === "choice") return withLogits(choiceFromScores(q.name, q.values, scores, "head"), lastLogits);
      if (q.type === "score") return withLogits(scoreFromLogits(q.name, q.values, scores, "head"), lastLogits);
      const c = choiceFromScores(q.name, ["no", "yes"], scores, "head");
      return withLogits(predicateFromP(q.name, c.probabilities[1].probability, "head", scores[1] - scores[0]), lastLogits);
    } };
  }
  return { q, enc, positions: [enc.decide, enc.last], read: ({ hiddens, lastLogits }) => {
    const raw = headScore(hd, hiddens[0], hiddens[1]);
    if (!Number.isFinite(raw)) throw new Error(`question ${q.name}: head score is not finite`);
    const a = q.type === "predicate" ? predicateFromP(q.name, sigmoid(raw), "head", raw) : scoreFromHead(q.name, q.values, raw);
    return withLogits(a, lastLogits);
  } };
}
var oneLine = (s) => s.split(/\s+/).filter(Boolean).join(" ");
function planEvidence(e, ev, state) {
  const m = e.manifest;
  if (!ev || typeof ev !== "object") throw new Error("decide: evidence must be an object {requirement?, instructions?, sentences?}");
  if (!e.backend.hiddenName) throw new Error("evidence: needs a hidden-state output, which this build does not have");
  const hd0 = e.heads.evidence;
  if (!hd0) throw new Error('evidence: this build/manifest has no head of type "evidence"');
  if (isLinear(hd0) || isJoint(hd0)) throw new Error("evidence: the evidence selector is a pointer head (spec 6.7)");
  const hd = hd0;
  let instructions;
  if (ev.instructions !== void 0) {
    if (typeof ev.instructions !== "string" || !ev.instructions.trim()) throw new Error("evidence.instructions: non-empty string");
    instructions = ev.instructions;
  } else {
    if (!m.evidence) throw new Error("evidence: the manifest has no evidence.instructions; pass evidence.instructions");
    if (m.evidence.instructions.includes("{requirement}") && (typeof ev.requirement !== "string" || !ev.requirement.trim()))
      throw new Error("evidence.requirement: required by the manifest's evidence.instructions ({requirement})");
    instructions = fill(m.evidence.instructions, { requirement: ev.requirement ?? "" }).text;
  }
  const src = ev.sentences ?? splitSentences(state);
  if (!Array.isArray(src)) throw new Error("evidence.sentences: string[]");
  const sentences = src.map((x, i) => {
    if (typeof x !== "string" || !oneLine(x)) throw new Error(`evidence.sentences[${i}]: empty or non-string sentence`);
    return oneLine(x);
  });
  if (sentences.length < 2) throw new Error(`evidence: needs at least 2 sentences, got ${sentences.length}`);
  const pre = m.evidence?.sentencePrefix ?? "";
  const q = { name: "evidence", type: "choice", instructions, values: sentences.map((_, i) => String(i)), texts: sentences.map((x) => pre + x) };
  const enc = encodeQuestion(e.tok, m, q, state);
  if (enc.ids.length > e.maxSafeTokens) throw new Error(`evidence: prompt has ${enc.ids.length} tokens, over maxSafeTokens (${e.maxSafeTokens})`);
  if (enc.options.length !== sentences.length) throw new Error(`evidence: found ${enc.options.length} option markers for ${sentences.length} sentences`);
  return { enc, positions: [enc.decide, ...enc.options], read: ({ hiddens }) => evidenceFromScores(sentences, hiddens.slice(1).map((h) => headScore(hd, hiddens[0], h))) };
}
function sharedPrefix(plans) {
  let k = Math.min(...plans.map((p) => p.enc.ids.length - 1), ...plans.flatMap((p) => p.positions));
  const a = plans[0].enc.ids;
  for (const p of plans.slice(1)) {
    let i = 0;
    while (i < k && p.enc.ids[i] === a[i]) i++;
    k = i;
  }
  return k;
}
function backOff(k, limits, minBlock) {
  if (!minBlock) return k;
  const kk = Math.min(k, ...limits);
  return kk >= minBlock ? kk : 0;
}
async function collect(e, gen, max, signal, onToken) {
  const ids = [];
  let text = "";
  for await (const id of gen) {
    ids.push(id);
    const full = e.tok.decode(ids, { skipSpecial: true });
    const stable = full.endsWith("\uFFFD") ? text : full;
    if (stable.length > text.length || !stable.startsWith(text)) {
      onToken?.(stable.slice(text.length), id);
      text = stable;
    }
  }
  text = e.tok.decode(ids, { skipSpecial: true });
  const finishReason = signal?.aborted ? "abort" : ids.length >= max ? "length" : "stop";
  return { text, tokenIds: ids, finishReason };
}
var thinkText = (m, on) => m.generation.think ? on ? m.generation.think.on : m.generation.think.off : "";
var DecisionSession = class {
  constructor(e, plans, answers, states) {
    this.e = e;
    this.plans = plans;
    this.answers = answers;
    this.states = states;
    this.sharedPrefill = states.length > 0 && states.every(Boolean);
  }
  e;
  plans;
  answers;
  /** True when the decision prefill was kept and generate() continues from it. */
  sharedPrefill;
  /** Evidence selector output when the request asked for `evidence`, else null. */
  evidence = null;
  states;
  disposed = false;
  /** Forecast-layer rows of each question's prompt (set by decide when forecast was requested). */
  rows = [];
  /** The forecast of a question's prompt (default: the first), read from the rows captured by the decide prefill:
   *  no backend call, no second prefill. Needs decide(req, { forecast: true }). */
  forecast(opts = {}) {
    if (this.disposed) throw new Error("session disposed");
    const fx = this.e.forecast;
    if (!fx) throw new Error(this.e.forecastWhy ?? "forecast unsupported: this model has no forecast reader");
    if (!this.plans.length) throw new Error("session.forecast: this session has no questions (evidence only)");
    const i = opts.question === void 0 ? 0 : this.plans.findIndex((p) => p.q.name === opts.question);
    if (i < 0) throw new Error(`session.forecast: no question named ${JSON.stringify(opts.question)}`);
    const rows = this.rows[i];
    if (!rows) throw new Error("session.forecast: this session did not read the forecast layer; call decide(req, { forecast: true })");
    return fx.read(rows, this.plans[i].q.name, this.plans[i].enc.ids.length);
  }
  answer(name) {
    return this.answers.find((a) => a.name === name);
  }
  /** System 2 after question `i`'s decision prompt WITHOUT appending the decided answer (margin escalation):
   *  manifest generation.escalate, else generation.continue with an empty answer. Same kept-state rule as generate(). */
  async reconsider(i, prompt, opts = {}) {
    if (this.disposed) throw new Error("session disposed");
    const m = this.e.manifest, plan = this.plans[i];
    const tpl = m.generation.escalate ?? m.generation.continue;
    const cont = fill(tpl, { answer: "", prompt, think: thinkText(m, opts.think) }).text;
    return this.continueWith(i, [...plan.enc.ids, ...this.e.tok.encode(cont)], opts);
  }
  async continueWith(i, ids, opts) {
    const h = this.states[i], be = this.e.backend;
    const max = Math.max(0, Math.floor(opts.maxNewTokens ?? 512));
    if (h && be.generateFrom) {
      const r2 = await collect(this.e, be.generateFrom(h, ids, opts), max, opts.signal, opts.onToken);
      return { ...r2, sharedPrefill: true, reusedTokens: h.ids.length };
    }
    const r = await collect(this.e, be.generate(ids, opts), max, opts.signal, opts.onToken);
    return { ...r, sharedPrefill: false, reusedTokens: 0 };
  }
  /** System 2: continue after the decision (the answer, then a new user turn with `prompt`). */
  async generate(prompt, opts = {}) {
    if (this.disposed) throw new Error("session disposed");
    if (!this.plans.length) throw new Error("session.generate: this session has no questions (evidence only); use generate()");
    const i = opts.question === void 0 ? 0 : this.plans.findIndex((p) => p.q.name === opts.question);
    if (i < 0) throw new Error(`session.generate: no question named ${JSON.stringify(opts.question)}`);
    const m = this.e.manifest, plan = this.plans[i], a = this.answers[i];
    const answer = a.type === "predicate" ? m.generation.answers.predicate[decisionOf(a) === "yes" ? 1 : 0] : decisionOf(a);
    const cont = fill(m.generation.continue, { answer, prompt, think: thinkText(m, opts.think) }).text;
    return this.continueWith(i, [...plan.enc.ids, ...this.e.tok.encode(cont)], opts);
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const s = this.states;
    this.states = [];
    for (const h of s) await h?.dispose();
  }
};
async function decide(e, req, opts = {}) {
  if (!req || typeof req !== "object") throw new Error("decide: expected { input, questions }");
  const state = inputToText(req.input);
  const noQuestions = req.questions === void 0 || Array.isArray(req.questions) && req.questions.length === 0;
  if (noQuestions && req.evidence === void 0) throw new Error("decide: questions must be a non-empty array or object (or pass evidence)");
  const qs = noQuestions ? [] : normalizeQuestions(req.questions, e.manifest);
  const plans = qs.map((q) => planQuestion(e, q, state, opts.method ?? req.method));
  const evPlan = req.evidence !== void 0 ? planEvidence(e, req.evidence, state) : null;
  const all = evPlan ? [...plans, evPlan] : plans;
  const be = e.backend;
  if (opts.forecast && !e.forecast) throw new Error(e.forecastWhy ?? "forecast unsupported: this model has no forecast reader");
  const fx = opts.forecast ? e.forecast : void 0;
  const extras = all.map((p, i) => fx && i < plans.length ? forecastPositions(fx.spec.pooling, plans[i].enc.last + 1) : void 0);
  const rows = [];
  const keep = (opts.keepState ?? true) && canShareState(be);
  const answers = [], states = [];
  let evidence = null;
  const k = all.length > 1 && be.snapshot && be.prefillFrom ? backOff(sharedPrefix(all.map((p, i) => ({ ...p, positions: [...p.positions, ...extras[i] ?? []] }))), all.map((p, i) => p.enc.ids.length - (keep && i < plans.length ? 2 : 1) * (be.minBlock ?? 0)), be.minBlock ?? 0) : 0;
  const take = (i, r0) => {
    const r = e.norm && r0.hiddens.length ? { ...r0, hiddens: r0.hiddens.map((h) => applyNorm(e.norm, h)) } : r0;
    if (i < plans.length) {
      states.push(r.state);
      rows[i] = r.extra;
      answers.push(plans[i].read(r));
    } else evidence = evPlan.read(r);
  };
  const wantOf = (i) => extras[i] ? { positions: all[i].positions, extra: { positions: extras[i] } } : { positions: all[i].positions };
  try {
    if (k < 1) {
      for (let i = 0; i < all.length; i++) take(i, await be.prefill(all[i].enc.ids, wantOf(i), { keep: keep && i < plans.length }));
    } else {
      const h = await be.snapshot(all[0].enc.ids.slice(0, k));
      try {
        for (let i = 0; i < all.length; i++) take(i, await be.prefillFrom(h, all[i].enc.ids, wantOf(i), { keep: keep && i < plans.length }));
      } finally {
        await h.dispose();
      }
    }
  } catch (err) {
    for (const s of states) await s?.dispose();
    throw err;
  }
  const session = new DecisionSession(e, plans, answers, keep ? states : []);
  session.evidence = evidence;
  session.rows = rows;
  if (opts.escalate && qs.length) {
    try {
      await escalate(e, req, qs, session, opts.escalate);
    } catch (err) {
      await session.dispose();
      throw err;
    }
  }
  return session;
}
async function escalate(e, req, qs, session, spec) {
  const call = spec === true ? void 0 : spec;
  if (call) {
    const { target: _t, ...rest } = call;
    const problems = [];
    escalationProblems(rest, "escalate", e.manifest, problems);
    if (problems.length) throw new Error("decide: invalid escalate option:\n  - " + problems.join("\n  - "));
  }
  const base = manifestPolicy(e.manifest, e.build);
  const policies = qs.map((q) => mergePolicy(...base, q.escalation, call));
  const answers = session.answers;
  const hits = [];
  qs.forEach((q, i) => {
    const p = policies[i];
    if (Object.keys(p.below).length && p.to === null) throw new Error(`question ${q.name}: margin policy has thresholds but no target ("to": "generate" or { build })`);
    const h = shouldEscalate(answers[i], p);
    if (h) hits.push({ i, threshold: h.threshold, value: h.value, p });
  });
  if (!hits.length) return;
  const record = (h) => ({ reason: "margin", metric: h.p.metric, margin: h.value, threshold: h.threshold, provisional: h.p.provisional, source: h.p.source });
  const byBuild = /* @__PURE__ */ new Map();
  for (const h of hits) if (h.p.to !== "generate" && h.p.to) byBuild.set(h.p.to.build, [...byBuild.get(h.p.to.build) ?? [], h]);
  const raw = questionEntries(req.questions);
  for (const [build, hs] of byBuild) {
    const target = call?.target ?? (e.resolveBuild ? await e.resolveBuild(build) : null);
    if (!target) throw new Error(`margin policy: no engine for build "${build}" (load one, or pass escalate.target)`);
    const sub = hs.map(({ i }) => ({ ...raw[i][1], name: qs[i].name }));
    const t = await target.decide({ input: req.input, questions: sub, ...req.method ? { method: req.method } : {} }, { keepState: false, escalate: false });
    try {
      hs.forEach((h, j) => {
        const i = h.i;
        const a = t.answers[j], s1 = answers[i];
        if (!a || a.name !== s1.name || a.type !== s1.type) throw new Error(`margin policy: build "${build}" answered ${a?.name}/${a?.type} for ${s1.name}/${s1.type}`);
        const { escalation: _drop, ...from } = s1;
        answers[i] = { ...a, path: "escalated", escalation: { ...record(h), to: "build", build, from } };
      });
    } finally {
      await t.dispose();
    }
  }
  for (const h of hits) {
    const { i, p } = h;
    if (p.to !== "generate") continue;
    const q = qs[i];
    const prompt = fill(p.prompt, { options: (q.type === "predicate" ? ["yes", "no"] : q.values).join(", ") }).text;
    const r = await session.reconsider(i, prompt, { maxNewTokens: p.maxNewTokens, temperature: 0 });
    answers[i] = { ...answers[i], path: "escalated", escalation: { ...record(h), to: "generate", text: r.text, sharedPrefill: r.sharedPrefill, reusedTokens: r.reusedTokens, finishReason: r.finishReason } };
  }
}
async function generate(e, prompt, opts = {}) {
  const m = e.manifest;
  const system = opts.system !== void 0 ? fill(m.generation.system ?? "{system}", { system: opts.system }).text : "";
  const text = fill(m.generation.turn, { prompt, system, think: thinkText(m, opts.think) }).text;
  const r = await collect(e, e.backend.generate(e.tok.encode(text), opts), Math.max(0, Math.floor(opts.maxNewTokens ?? 512)), opts.signal, opts.onToken);
  return { ...r, sharedPrefill: false, reusedTokens: 0 };
}

// src/runtime.ts
var DEVICES = ["webgpu", "wasm", "cpu", "cuda"];
function detectPlatform(g = globalThis) {
  const isNode = !!g.process?.versions?.node;
  const hasDom = typeof g.window !== "undefined" && typeof g.document !== "undefined";
  const isWorker = typeof g.WorkerGlobalScope !== "undefined" && typeof g.importScripts === "function";
  return isNode && !hasDom && !isWorker ? "node" : "browser";
}
async function detectWebGPU(nav = globalThis.navigator) {
  return (await webgpuStatus(nav)).ok;
}
async function webgpuStatus(nav = globalThis.navigator) {
  if (typeof nav?.gpu?.requestAdapter !== "function") return { ok: false, reason: "navigator.gpu is missing" };
  try {
    return await nav.gpu.requestAdapter() ? { ok: true } : { ok: false, reason: "navigator.gpu.requestAdapter() returned no adapter" };
  } catch (e) {
    return { ok: false, reason: `navigator.gpu.requestAdapter() failed: ${e?.message ?? String(e)}` };
  }
}
var GENAI_BROWSER_CPU_NOTE = 'A genai build runs on the browser CPU (onnxruntime-web WASM) only when its manifest lists device "wasm", i.e. the packager measured that path. Graphs with linear-attention ops cannot: onnxruntime-web has no WASM kernel for com.microsoft.GatedDeltaNet (Qwen3.5-family graphs such as S5-nano / CT0), so those builds need WebGPU.';
var noGpu = (caps) => `WebGPU is not available (${caps.webgpuReason ?? "no WebGPU adapter"})`;
function detectCuda(ortNode) {
  try {
    return !!ortNode?.listSupportedBackends?.().some((b) => b?.name === "cuda");
  } catch {
    return false;
  }
}
var GENAI_NODE_CPU_ERROR = `runtime "genai" does not run on onnxruntime-node CPU for this build (CT0's int4 GenAI graph has no CPU kernels for its linear-attention ops); in Node use "decode-only" or "transformers.js", genai on CUDA, or a build whose manifest lists device "cpu".`;
function checkDevice(platform, device) {
  if (!DEVICES.includes(device)) throw new Error(`unknown device "${device}". Use "auto", ${DEVICES.map((d) => `"${d}"`).join(", ")}.`);
  if (platform === "browser" && device === "cuda") throw new Error('device "cuda" is Node-only.');
  if (platform === "node" && (device === "webgpu" || device === "wasm")) throw new Error(`device "${device}" is browser-only.`);
}
function deviceFor(runtime, want, caps) {
  const { platform } = caps;
  const dev = platform === "browser" && want === "cpu" ? "wasm" : want;
  if (dev !== "auto") checkDevice(platform, dev);
  const needGpu = (d) => {
    if (d === "webgpu" && !caps.webgpu) throw new Error(`runtime "${runtime}" on WebGPU, but WebGPU is not available.`);
    return d;
  };
  const needCuda = (d) => {
    if (d === "cuda" && !caps.cuda) throw new Error(`runtime "${runtime}" on CUDA, but onnxruntime-node lists no CUDA provider.`);
    return d;
  };
  switch (runtime) {
    case "genai":
      if (platform === "browser") {
        if (dev === "wasm") throw new Error('runtime "genai" on the browser CPU (wasm) needs a build whose manifest lists device "wasm". ' + GENAI_BROWSER_CPU_NOTE);
        return needGpu("webgpu");
      }
      if (dev === "cpu") throw new Error(GENAI_NODE_CPU_ERROR);
      if (!caps.cuda) throw new Error(GENAI_NODE_CPU_ERROR + " No CUDA provider was found.");
      return "cuda";
    case "webllm":
    case "litert":
      if (platform === "node") throw new Error(`runtime "${runtime}" runs only in the browser (WebGPU).`);
      if (dev === "wasm") throw new Error(`runtime "${runtime}" needs WebGPU.`);
      return needGpu("webgpu");
    case "decode-only":
    case "transformers.js":
      if (dev !== "auto") return platform === "browser" ? needGpu(dev) : needCuda(dev);
      return platform === "browser" ? caps.webgpu ? "webgpu" : "wasm" : "cpu";
  }
}
function autoOrder(device, caps) {
  const { platform } = caps;
  const dev = platform === "browser" && device === "cpu" ? "wasm" : device;
  if (dev !== "auto") checkDevice(platform, dev);
  if (platform === "browser") {
    if (dev === "wasm" || !caps.webgpu) return [{ runtime: "genai", device: "wasm" }, { runtime: "decode-only", device: "wasm" }, { runtime: "transformers.js", device: "wasm" }];
    return [{ runtime: "genai", device: "webgpu" }, { runtime: "decode-only", device: "webgpu" }, { runtime: "transformers.js", device: "webgpu" }];
  }
  const nodeCpu = [{ runtime: "transformers.js", device: "cpu" }, { runtime: "decode-only", device: "cpu" }];
  if (dev === "cpu" || !caps.cuda) return nodeCpu;
  return [{ runtime: "genai", device: "cuda" }, { runtime: "transformers.js", device: "cuda" }, ...nodeCpu];
}
function planBuilds(m, o, caps) {
  const device = o.device ?? "auto";
  const builds = Object.entries(m.builds);
  const browser = caps.platform === "browser";
  const wantWasm = browser && (device === "wasm" || device === "cpu");
  const autoNoGpu = browser && device === "auto" && !caps.webgpu;
  if (autoNoGpu && o.cpuFallback === false)
    throw new Error(`${noGpu(caps)}, and cpuFallback is false: no automatic move to the browser CPU (WASM). Pass device "wasm" to ask for it.`);
  const listDevices = () => builds.map(([n, b]) => `${n} (${b.runtime}: ${b.devices.join(", ")})`).join("; ");
  if (o.build !== void 0) {
    const b = m.builds[o.build];
    if (!b) throw new Error(`unknown build "${o.build}"; manifest has ${Object.keys(m.builds).join(", ")}`);
    if (o.runtime && o.runtime !== "auto" && o.runtime !== b.runtime) throw new Error(`build "${o.build}" is runtime ${b.runtime}, not ${o.runtime}`);
    if (b.runtime === "genai" && caps.platform === "node" && b.devices.includes("cpu") && (device === "cpu" || device === "auto" && !caps.cuda))
      return [{ build: o.build, runtime: "genai", device: "cpu" }];
    if (b.runtime === "genai" && (wantWasm || autoNoGpu)) {
      if (b.devices.includes("wasm")) return [{ build: o.build, runtime: "genai", device: "wasm" }];
      throw new Error(`build "${o.build}" cannot run here: ${autoNoGpu ? noGpu(caps) + ", and " : ""}its manifest lists device ${b.devices.join(", ")}, not "wasm". ${GENAI_BROWSER_CPU_NOTE}`);
    }
    const d = deviceFor(b.runtime, device, caps);
    if (!b.devices.includes(d)) throw new Error(`build "${o.build}" does not list device ${d} (has ${b.devices.join(", ")})`);
    return [{ build: o.build, runtime: b.runtime, device: d }];
  }
  if (o.runtime && o.runtime !== "auto") {
    if (!RUNTIMES.includes(o.runtime)) throw new Error(`unknown runtime "${o.runtime}"`);
    if (o.runtime === "genai" && (wantWasm || autoNoGpu)) {
      const hit2 = builds.find(([, b]) => b.runtime === "genai" && b.devices.includes("wasm"));
      if (hit2) return [{ build: hit2[0], runtime: "genai", device: "wasm" }];
      throw new Error(`manifest has no genai build for device wasm${autoNoGpu ? ` (${noGpu(caps)})` : ""}; builds: ${listDevices()}. ${GENAI_BROWSER_CPU_NOTE}`);
    }
    const d = deviceFor(o.runtime, device, caps);
    const hit = builds.find(([, b]) => b.runtime === o.runtime && b.devices.includes(d));
    if (!hit) throw new Error(`manifest has no ${o.runtime} build for device ${d}`);
    return [{ build: hit[0], runtime: o.runtime, device: d }];
  }
  const out = [];
  for (const c of autoOrder(device, caps)) {
    const hit = builds.find(([, b]) => b.runtime === c.runtime && b.devices.includes(c.device));
    if (hit) out.push({ build: hit[0], ...c });
  }
  if (!out.length) {
    const why = browser && (autoNoGpu || wantWasm) ? ` ${autoNoGpu ? noGpu(caps) + "; " : ""}no build lists device "wasm" (builds: ${listDevices()}). ${GENAI_BROWSER_CPU_NOTE}` : "";
    throw new Error(`no build in the manifest runs here (${caps.platform}, device ${device}).${why}`);
  }
  return out;
}
async function importOptional(pkg, importer, why) {
  try {
    return await importer();
  } catch (e) {
    const msg = String(e?.message ?? e);
    const notFound = e?.code === "ERR_MODULE_NOT_FOUND" || e?.code === "MODULE_NOT_FOUND" || /Cannot find (package|module)|Failed to resolve module specifier|Failed to fetch dynamically imported module/.test(msg);
    if (!notFound) throw e;
    const err = new Error(`${why} needs the package "${pkg}", which is not installed: npm i ${pkg}`);
    err.cause = e;
    throw err;
  }
}

// src/backends/common.ts
var F16 = globalThis.Float16Array;
function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function halfToNumber(h) {
  const s = h & 32768 ? -1 : 1, e = (h & 31744) >> 10, f = h & 1023;
  return e === 0 ? s * Math.pow(2, -14) * (f / 1024) : e === 31 ? f ? NaN : s * Infinity : s * Math.pow(2, e - 15) * (1 + f / 1024);
}
function tensorToF32(data, type, off = 0, n = data.length - off) {
  const out = new Float32Array(n);
  const isF16Arr = typeof F16 !== "undefined" && data instanceof F16;
  if (data instanceof Float32Array || isF16Arr) {
    for (let i = 0; i < n; i++) out[i] = Number(data[off + i]);
  } else if (type === "float16" || data instanceof Uint16Array) {
    for (let i = 0; i < n; i++) out[i] = halfToNumber(data[off + i]);
  } else for (let i = 0; i < n; i++) out[i] = Number(data[off + i]);
  return out;
}
function lastRow(L) {
  const V = L.dims.at(-1), off = (L.dims.at(-2) - 1) * V;
  return tensorToF32(L.data, L.type, off, V);
}
function sample(logits, gen, rand, o) {
  const { temperature: temp, topP, topK, repetitionPenalty: rep } = o;
  if (rep !== 1) for (const t of new Set(gen)) logits[t] = logits[t] > 0 ? logits[t] / rep : logits[t] * rep;
  if (temp <= 0) {
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < logits.length; i++) if (logits[i] > bv) {
      bv = logits[i];
      bi = i;
    }
    return bi;
  }
  let idx = Array.from(logits.keys());
  idx.sort((a, b) => logits[b] - logits[a]);
  if (topK > 0) idx = idx.slice(0, topK);
  const mx = logits[idx[0]];
  let probs = idx.map((i) => Math.exp((logits[i] - mx) / temp));
  const s = probs.reduce((a, b) => a + b, 0);
  probs = probs.map((p) => p / s);
  if (topP < 1) {
    let c = 0, cut = idx.length;
    for (let i = 0; i < idx.length; i++) {
      c += probs[i];
      if (c >= topP) {
        cut = i + 1;
        break;
      }
    }
    idx = idx.slice(0, cut);
    probs = probs.slice(0, cut);
    const z = probs.reduce((a, b) => a + b, 0);
    probs = probs.map((p) => p / z);
  }
  const r = rand();
  let acc = 0;
  for (let i = 0; i < idx.length; i++) {
    acc += probs[i];
    if (r <= acc) return idx[i];
  }
  return idx[idx.length - 1];
}
function pastNameFor(out) {
  let m;
  if (m = out.match(/^present_conv\.(\d+)$/)) return "past_conv." + m[1];
  if (m = out.match(/^present_recurrent\.(\d+)$/)) return "past_recurrent." + m[1];
  if (m = out.match(/^present\.(\d+)\.(key|value)$/)) return `past_key_values.${m[1]}.${m[2]}`;
  if (m = out.match(/^present\.(\d+)\.(conv|recurrent)$/)) return `past.${m[1]}.${m[2]}`;
  if (m = out.match(/^so(\d+)$/)) return "si" + m[1];
  return null;
}
function cacheDims(name, shape, pastLen) {
  const isKV = /^past_key_values\./.test(name) || shape.length === 4 && !/conv|recurrent/.test(name) && typeof shape[2] !== "number";
  return shape.map((d, i) => typeof d === "number" && d >= 0 ? d : isKV && i === 2 ? pastLen : 1);
}
function inputMeta(session) {
  const meta = Array.isArray(session.inputMetadata) ? session.inputMetadata : Object.entries(session.inputMetadata ?? {}).map(([name, m]) => ({ name, ...m }));
  return new Map(meta.map((m) => [m.name, m]));
}
function resolveHidden(name, outNames, hiddenOutput) {
  if (hiddenOutput == null) return null;
  if (!outNames.includes(hiddenOutput)) throw new Error(`${name}: manifest hiddenOutput ${JSON.stringify(hiddenOutput)} is not an output of the graph (outputs: ${outNames.slice(0, 4).join(", ")}${outNames.length > 4 ? ", ..." : ""})`);
  return hiddenOutput;
}
function assertFiniteRow(name, output, row) {
  for (let i = 0; i < row.length; i++) if (!Number.isFinite(row[i])) throw new Error(`${name}: forecast output ${output} is not finite at index ${i} (fp16 overflow of the raw residual stream, or a broken graph); use a build in fp32 or another layer`);
}
function checkOrtVersion(v, min = [1, 30]) {
  const m = /^(\d+)\.(\d+)/.exec(v ?? "");
  if (!m) return;
  if (Number(m[1]) < min[0] || Number(m[1]) === min[0] && Number(m[2]) < min[1])
    throw new Error(`onnxruntime ${v} is too old; requires >= ${min.join(".")} (WebGPU returns NaN below that; genai needs the LinearAttention/CausalConvWithState kernels). Pass skipVersionCheck to ignore.`);
}

// src/backends/embeddings.ts
function embeddingTable(read, size, hidden, opts = {}) {
  const rowBytes = hidden * 2;
  if (!Number.isInteger(hidden) || hidden <= 0) throw new Error(`embeddings: bad hidden size ${hidden}`);
  if (size % rowBytes !== 0) throw new Error(`embeddings: file size ${size} is not a multiple of hidden * 2 = ${rowBytes} (expected fp16 [vocab, ${hidden}])`);
  const vocab = size / rowBytes;
  const max = opts.cacheRows ?? 8192;
  const cache = /* @__PURE__ */ new Map();
  const row = async (id) => {
    let r = cache.get(id);
    if (r) {
      cache.delete(id);
      cache.set(id, r);
      return r;
    }
    const b = await read(id * rowBytes, rowBytes);
    if (b.byteLength !== rowBytes) throw new Error(`embeddings: short read for token ${id} (${b.byteLength} of ${rowBytes} bytes)`);
    r = new Uint16Array(hidden);
    new Uint8Array(r.buffer).set(b);
    if (cache.size >= max) cache.delete(cache.keys().next().value);
    cache.set(id, r);
    return r;
  };
  return {
    hidden,
    vocab,
    async rows(ids) {
      for (const id of ids) if (!Number.isInteger(id) || id < 0 || id >= vocab) throw new Error(`embeddings: token ${id} outside the table (vocab ${vocab})`);
      const got = /* @__PURE__ */ new Map();
      for (const id of new Set(ids)) got.set(id, await row(id));
      const out = new Uint16Array(ids.length * hidden);
      ids.forEach((id, i) => out.set(got.get(id), i * hidden));
      return out;
    },
    close: opts.close
  };
}
function embeddingTableFromBytes(bytes, hidden) {
  return embeddingTable(async (o, n) => bytes.subarray(o, o + n), bytes.byteLength, hidden, { cacheRows: 0 });
}
function httpRangeTable(url, size, hidden, fetchFn = fetch) {
  return embeddingTable(async (offset, length) => {
    const r = await fetchFn(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (r.status !== 206) throw new Error(`embeddings: ${url} answered HTTP ${r.status} to a Range request; the table is read row by row, so the server must support Range (206)`);
    return new Uint8Array(await r.arrayBuffer());
  }, size, hidden);
}
async function fileTable(path, hidden) {
  const spec = "node:fs/promises";
  const fs = await import(
    /* @vite-ignore */
    spec
  );
  const fh = await fs.open(path, "r");
  const { size } = await fh.stat();
  return embeddingTable(async (offset, length) => {
    const b = new Uint8Array(length);
    const { bytesRead } = await fh.read(b, 0, length, offset);
    return b.subarray(0, bytesRead);
  }, size, hidden, { close: () => fh.close() });
}
function h2f(h) {
  const s = h & 32768 ? -1 : 1, e = h >> 10 & 31, f = h & 1023;
  return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? f ? NaN : s * Infinity : s * 2 ** (e - 15) * (1 + f / 1024);
}
function f16ToF322(b) {
  const out = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = h2f(b[i]);
  return out;
}

// src/backends/genai.ts
function blockPlan(len, chunk, minBlock) {
  const out = [];
  for (let p = 0; p < len; p += chunk) out.push(Math.min(chunk, len - p));
  if (minBlock > 0 && out.length > 1 && out[out.length - 1] < minBlock) out[out.length - 2] += out.pop();
  return out;
}
function parsePlacement(lines) {
  const out = {};
  for (const l of lines) {
    const m = /(?:Node\(s\)|All nodes) placed on \[(\w+)\]\.\s*Number of nodes:\s*(\d+)/.exec(l);
    if (m) out[m[1]] = (out[m[1]] ?? 0) + Number(m[2]);
  }
  return out;
}
function assertWebGpuPlacement(p, maxCpuNodes = 32) {
  const gpu = Object.entries(p).filter(([k]) => /webgpu/i.test(k)).reduce((a, [, n]) => a + n, 0);
  const cpu = p.CPUExecutionProvider ?? 0;
  if (!Object.keys(p).length) throw new Error("genai: could not verify the EP placement (no 'Node(s) placed on' logs)");
  if (gpu === 0) throw new Error(`genai: no node on the WebGPU EP (placement: ${JSON.stringify(p)})`);
  if (cpu > maxCpuNodes) throw new Error(`genai: ${cpu} nodes on CPU (> ${maxCpuNodes}); probably a bundle without the WebGPU kernels. Placement: ${JSON.stringify(p)}`);
}
function genaiFromSession(session, ort, opts) {
  const T2 = ort.Tensor;
  if (!(opts?.eos instanceof Set) || !opts.eos.size) throw new Error("genai: opts.eos (Set of EOS ids from the manifest) is required");
  const eos = opts.eos;
  const inNames = session.inputNames, outNames = session.outputNames;
  const metaBy = inputMeta(session);
  const byEmbeds = !inNames.includes("input_ids") && inNames.includes("inputs_embeds");
  if (!inNames.includes("input_ids") && !byEmbeds) throw new Error("genai: graph without input input_ids (or inputs_embeds)");
  const emb = opts.embeddings;
  let embType = "";
  if (byEmbeds) {
    if (!emb) throw new Error('genai: the graph takes inputs_embeds (built with exclude_embeds) but the build has no embeddings table; add the file role "embeddings" (fp16 [vocab, hidden]) to the manifest build');
    const m = metaBy.get("inputs_embeds");
    const h = m?.shape?.at(-1);
    if (typeof h === "number" && h !== emb.hidden) throw new Error(`genai: inputs_embeds hidden ${h} != embeddings table hidden ${emb.hidden}`);
    embType = m?.type ?? "float16";
    if (embType !== "float16" && embType !== "float32") throw new Error(`genai: unsupported inputs_embeds dtype ${embType}`);
  } else if (emb) throw new Error("genai: the build pins an embeddings table but the graph takes input_ids (embedding in the graph)");
  if (!outNames.includes("logits")) throw new Error("genai: graph without a logits output");
  const hasMask = inNames.includes("attention_mask"), hasPos = inNames.includes("position_ids");
  const specs = [];
  for (const n of inNames) {
    if (n === "input_ids" || n === "inputs_embeds" || n === "attention_mask" || n === "position_ids") continue;
    const m = metaBy.get(n);
    if (!m?.shape) throw new Error("genai: no shape metadata for input " + n);
    const dims = cacheDims(n, m.shape, 0);
    if (/^past_key_values\./.test(n) && typeof m.shape[3] !== "number") {
      if (!opts.kvHeadDim) throw new Error(`genai: KV head dim of ${n} is symbolic; pass kvHeadDim (genai_config head_size)`);
      dims[3] = opts.kvHeadDim;
    }
    specs.push({ name: n, type: m.type, dims });
  }
  const pastOf = /* @__PURE__ */ new Map();
  for (const o of outNames) {
    const p = pastNameFor(o);
    if (p && inNames.includes(p)) pastOf.set(o, p);
  }
  const covered = new Set(pastOf.values());
  const missing = specs.filter((s) => !covered.has(s.name));
  if (missing.length) throw new Error("genai: cache inputs without a present output: " + missing.slice(0, 3).map((s) => s.name).join(", "));
  const hiddenName = resolveHidden("genai", outNames, opts.hiddenOutput);
  const extraName = resolveHidden("genai", outNames, opts.forecastOutput);
  const posRows = (() => {
    const sh = metaBy.get("position_ids")?.shape;
    return typeof sh?.[0] === "number" ? sh[0] : 3;
  })();
  const zeros = (s) => {
    const n = s.dims.reduce((a, b) => a * b, 1);
    if (s.type === "float16") return new T2("float16", new Uint16Array(n), s.dims);
    if (s.type === "float32") return new T2("float32", new Float32Array(n), s.dims);
    throw new Error(`genai: unsupported cache dtype: ${s.type}`);
  };
  const initState = () => {
    const st = {};
    for (const s of specs) st[s.name] = zeros(s);
    return st;
  };
  const free = (st) => {
    if (st) {
      for (const t of Object.values(st)) if (t?.location === "gpu-buffer") {
        try {
          t.dispose?.();
        } catch {
        }
      }
    }
  };
  const gate = createGate("genai");
  const mb = Math.floor(opts.minBlock ?? 32);
  const minBlock = Number.isFinite(mb) && mb > 0 ? mb : 0;
  async function run(chunk, past, st, wantLogits, wantHidden, keepInput, wantExtra = false) {
    const S = chunk.length;
    const feed = { ...st };
    if (byEmbeds) {
      const raw = await emb.rows(chunk);
      feed.inputs_embeds = embType === "float16" ? new T2("float16", raw, [1, S, emb.hidden]) : new T2("float32", f16ToF322(raw), [1, S, emb.hidden]);
    } else feed.input_ids = new T2("int64", BigInt64Array.from(chunk.map(BigInt)), [1, S]);
    if (hasMask) feed.attention_mask = new T2("int64", new BigInt64Array(past + S).fill(1n), [1, past + S]);
    if (hasPos) {
      const pos = new BigInt64Array(posRows * S);
      for (let r2 = 0; r2 < posRows; r2++) for (let i = 0; i < S; i++) pos[r2 * S + i] = BigInt(past + i);
      feed.position_ids = new T2("int64", pos, [posRows, 1, S]);
    }
    const fetches = [...pastOf.keys()];
    if (wantLogits) fetches.unshift("logits");
    if (wantHidden && hiddenName) fetches.push(hiddenName);
    if (wantExtra && extraName) fetches.push(extraName);
    const r = await session.run(feed, fetches, { logSeverityLevel: 3 });
    const ns = {};
    for (const [o, p] of pastOf) ns[p] = r[o];
    if (!keepInput) free(st);
    return { st: ns, out: { logits: wantLogits ? r.logits : void 0, hidden: wantHidden && hiddenName ? r[hiddenName] : void 0, extra: wantExtra && extraName ? r[extraName] : void 0 } };
  }
  const read = async (t) => typeof t.getData === "function" ? await t.getData(true) : t.data;
  async function feedAll(ids, wanted, wantLast, signal, from, keepAt, extraWanted = /* @__PURE__ */ new Set()) {
    let st = from?.st ?? initState(), past = from?.past ?? 0;
    const kept = from?.st;
    let mid;
    const start = past, cut = keepAt !== void 0 && keepAt > start && keepAt < ids.length ? keepAt : void 0;
    const plan = cut === void 0 ? blockPlan(ids.length - start, self.chunk, self.minBlock) : [...blockPlan(cut - start, self.chunk, self.minBlock), ...blockPlan(ids.length - cut, self.chunk, self.minBlock)];
    const hid = /* @__PURE__ */ new Map(), ext = /* @__PURE__ */ new Map();
    let lastLogits;
    const alive = (s) => s === kept || s === mid;
    try {
      for (const len of plan) {
        if (signal?.aborted) {
          if (mid && mid !== st) free(mid);
          return { st, past, hid, ext, lastLogits, aborted: true, owned: st !== kept, mid: void 0 };
        }
        const chunk = ids.slice(past, past + len), last = past + chunk.length >= ids.length;
        const need2 = [...wanted].filter((p) => p >= past && p < past + chunk.length);
        const needX = [...extraWanted].filter((p) => p >= past && p < past + chunk.length);
        const r = await run(chunk, past, st, last && wantLast, need2.length > 0, alive(st), needX.length > 0);
        st = r.st;
        if (r.out.extra) {
          const X = r.out.extra, D = X.dims.at(-1), d = await read(X);
          for (const p of needX) {
            const row = tensorToF32(d, X.type, (p - past) * D, D);
            assertFiniteRow("genai", extraName, row);
            ext.set(p, row);
          }
        }
        if (r.out.hidden) {
          const H = r.out.hidden, D = H.dims.at(-1), d = await read(H);
          for (const p of need2) hid.set(p, tensorToF32(d, H.type, (p - past) * D, D));
        }
        if (r.out.logits) {
          const L = r.out.logits, V = L.dims.at(-1), d = await read(L);
          lastLogits = tensorToF32(d, L.type, (L.dims.at(-2) - 1) * V, V);
        }
        past += chunk.length;
        if (past === cut) mid = st;
      }
    } catch (e) {
      if (st !== kept) free(st);
      if (mid && mid !== st) free(mid);
      throw e;
    }
    return { st, past, hid, ext, lastLogits, aborted: false, owned: st !== kept, mid };
  }
  const keepPoint = (start, n) => {
    const M = self.minBlock;
    if (!M) return n;
    const kp = n - M;
    return kp - start >= M ? kp : null;
  };
  const checkTail = (k, n) => {
    if (self.minBlock && n - k < self.minBlock) throw new Error(`genai: continuation of ${n - k} tokens past the kept state; shared prefill feeds at least minBlock (${self.minBlock}) tokens so it stays exact on WebGPU. Keep the state earlier, or prefill from scratch`);
  };
  const snaps = /* @__PURE__ */ new WeakMap();
  const handle = (ids, st) => {
    let live = st;
    const h = { ids: ids.slice(), dispose: async () => {
      if (!live) return;
      const s0 = live;
      live = null;
      snaps.delete(h);
      let r = null;
      try {
        r = await gate.acquire();
      } catch {
      }
      try {
        free(s0);
      } finally {
        r?.();
      }
    } };
    snaps.set(h, st);
    return h;
  };
  const finish = (ids, f, positions, keep, kp, extra = []) => {
    const res = { hiddens: positions.map((p) => f.hid.get(p)), lastLogits: f.lastLogits };
    if (extra.length) res.extra = extra.map((p) => f.ext.get(p));
    if (keep && kp === ids.length) {
      res.state = handle(ids, f.st);
      return res;
    }
    if (keep && kp !== null && f.mid) res.state = handle(ids.slice(0, kp), f.mid);
    if (f.owned) free(f.st);
    return res;
  };
  const prefillTo = async (ids, positions, keep, from, extra = []) => {
    const kp = keep ? keepPoint(from?.past ?? 0, ids.length) : null;
    const f = await feedAll(ids, new Set(positions), true, void 0, from, kp ?? void 0, new Set(extra));
    return finish(ids, f, positions, keep, kp, extra);
  };
  const stateOf = (h) => {
    const st = snaps.get(h);
    if (!st) throw new Error("genai: unknown or released state handle");
    return st;
  };
  const needExtra = (extra) => {
    if (extra?.positions.length && !extraName) throw new Error("forecast unsupported: this genai build exposes no forecast layer (export it with the forecast layer option and set build.forecastOutput)");
  };
  const needHidden = (positions) => {
    if (positions.length && !hiddenName) throw new Error("genai: this build has no hidden output; use method 'logits'");
  };
  async function* decodeLoop(ids, o, from) {
    const g = resolveGenerateOptions(o);
    const rand = mulberry32(g.seed);
    if (g.maxNewTokens === 0) return;
    const rel = await gate.acquire();
    let st = null, owned = false;
    try {
      if (o.signal?.aborted) return;
      if (from) checkTail(from.past, ids.length);
      const f = await feedAll(ids, /* @__PURE__ */ new Set(), true, o.signal, from);
      st = f.st;
      owned = f.owned;
      if (f.aborted) return;
      let past = f.past, logits = f.lastLogits;
      const gen = [];
      for (let s = 0; s < g.maxNewTokens; s++) {
        if (o.signal?.aborted) break;
        const tid = sample(logits, gen, rand, g);
        if (eos.has(tid)) break;
        gen.push(tid);
        yield tid;
        if (o.signal?.aborted || s + 1 >= g.maxNewTokens) break;
        const r = await run([tid], past, st, true, false, !owned);
        st = r.st;
        owned = true;
        past++;
        const L = r.out.logits, V = L.dims.at(-1);
        logits = tensorToF32(await read(L), L.type, (L.dims.at(-2) - 1) * V, V);
      }
    } finally {
      if (owned) free(st);
      rel();
    }
  }
  const self = {
    kind: "genai",
    minBlock,
    chunk: Math.max(1, Math.floor(opts.chunk ?? 128) || 1, minBlock),
    hiddenName,
    extraName,
    dispose() {
      return gate.dispose(async () => {
        try {
          await session.release?.();
        } finally {
          await emb?.close?.();
        }
      });
    },
    async prefill(ids, want, o = {}) {
      gate.assertLive();
      checkPositions("genai", ids, [...want.positions, ...want.extra?.positions ?? []]);
      needHidden(want.positions);
      needExtra(want.extra);
      const rel = await gate.acquire();
      try {
        return await prefillTo(ids, want.positions, o.keep, void 0, want.extra?.positions);
      } finally {
        rel();
      }
    },
    async snapshot(ids) {
      gate.assertLive();
      if (!ids.length) throw new Error("genai: snapshot of empty ids");
      if (ids.length < self.minBlock) throw new Error(`genai: snapshot of ${ids.length} tokens; a kept state needs at least minBlock (${self.minBlock}) tokens to stay exact on WebGPU`);
      const rel = await gate.acquire();
      try {
        return handle(ids, (await feedAll(ids, /* @__PURE__ */ new Set(), false)).st);
      } finally {
        rel();
      }
    },
    async prefillFrom(h, ids, want, o = {}) {
      gate.assertLive();
      const st = stateOf(h);
      const k = checkContinuation("genai", h, ids, [...want.positions, ...want.extra?.positions ?? []]);
      needHidden(want.positions);
      needExtra(want.extra);
      checkTail(k, ids.length);
      const rel = await gate.acquire();
      try {
        return await prefillTo(ids, want.positions, o.keep, { st, past: k }, want.extra?.positions);
      } finally {
        rel();
      }
    },
    async *generate(ids, o) {
      gate.assertLive();
      if (!ids.length) throw new Error("generate: empty ids");
      yield* decodeLoop(ids, o);
    },
    async *generateFrom(h, ids, o) {
      gate.assertLive();
      const st = stateOf(h);
      const k = checkContinuation("genai", h, ids, []);
      yield* decodeLoop(ids, o, { st, past: k });
    }
  };
  return self;
}
function hashStr(x) {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
async function adapterTag(opts) {
  if (typeof opts.adapterTag === "string") return opts.adapterTag;
  if (typeof opts.adapterTag === "function") return opts.adapterTag();
  try {
    const ad = await globalThis.navigator?.gpu?.requestAdapter?.();
    const i = ad?.info ?? await ad?.requestAdapterInfo?.();
    return i ? hashStr([i.vendor, i.architecture, i.device, i.description].join("|")) : "?";
  } catch {
    return "?";
  }
}
function epStore(opts) {
  if (opts.epCache !== void 0) return opts.epCache;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
async function probePlacement(ort, model, sessionOpts, maxCpuNodes) {
  const captured = [];
  const names = ["log", "info", "warn", "error", "debug"];
  const saved = {};
  const prevLevel = ort.env?.logLevel;
  if (ort.env) ort.env.logLevel = "verbose";
  for (const n of names) {
    saved[n] = console[n];
    console[n] = (...a) => {
      const s = a.join(" ");
      if (/(?:Node\(s\)|All nodes) placed on/.test(s)) captured.push(s);
      else if (!s.includes("[V:onnxruntime") && !/WebGPU Shader code|^\s*$/.test(s)) saved[n].apply(console, a);
    };
  }
  let probe;
  try {
    probe = await ort.InferenceSession.create(model, sessionOpts(0));
  } finally {
    for (const n of names) console[n] = saved[n];
    if (ort.env) ort.env.logLevel = prevLevel;
  }
  try {
    assertWebGpuPlacement(parsePlacement(captured), maxCpuNodes);
  } finally {
    await probe.release?.();
  }
}
async function createGenai(model, dataUrl, dataName, opts) {
  const modelKey = opts.modelKey ?? (typeof model === "string" ? model : `bytes:${model.byteLength}`);
  const providers = opts.providers ?? ["webgpu"];
  if (providers.length === 1 && providers[0] === "wasm") return createGenaiWasm(model, dataUrl, dataName, opts);
  if (providers[0] !== "webgpu") throw new Error('genai: the browser graph runs on providers ["webgpu", ...] or ["wasm"]');
  const ort = opts.ort ?? await import("onnxruntime-web/webgpu");
  const verify = opts.verifyEp ?? false;
  const sessionOpts = (level) => ({
    executionProviders: providers.map((n) => n === "webgpu" ? { name: "webgpu", validationMode: "disabled" } : n),
    externalData: [{ path: dataName, data: dataUrl }],
    graphOptimizationLevel: "all",
    enableGraphCapture: false,
    preferredOutputLocation: "gpu-buffer",
    logSeverityLevel: level
  });
  if (!opts.skipVersionCheck) checkOrtVersion(ort.env?.versions?.web);
  if (verify) {
    const store = epStore(opts);
    const maxCpu = opts.maxCpuNodes ?? 32;
    const key = store ? `s1s2:genai-ep:${ort.env?.versions?.web ?? "?"}:${await adapterTag(opts)}:${modelKey}:${dataUrl}:${maxCpu}` : "";
    let cached = false;
    if (verify !== "force" && store) {
      try {
        cached = store.getItem(key) === "ok";
      } catch {
      }
    }
    if (!cached) {
      await probePlacement(ort, model, sessionOpts, maxCpu);
      if (store) {
        try {
          store.setItem(key, "ok");
        } catch {
        }
      }
    }
  }
  const session = await ort.InferenceSession.create(model, sessionOpts(3));
  return wrapSession(session, ort, opts);
}
async function createGenaiWasm(model, dataUrl, dataName, opts) {
  const ort = opts.ort ?? await import("onnxruntime-web/wasm");
  if (!opts.skipVersionCheck) checkOrtVersion(ort.env?.versions?.web);
  let session;
  try {
    session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], externalData: [{ path: dataName, data: dataUrl }] });
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/Failed to find kernel/i.test(msg)) {
      const err = new Error(`genai on the browser CPU (WASM): onnxruntime-web has no WASM kernel for an op of this graph (${msg.slice(0, 300)}). This build needs WebGPU.`);
      err.cause = e;
      throw err;
    }
    throw e;
  }
  return wrapSession(session, ort, opts);
}
async function wrapSession(session, ort, opts) {
  try {
    const be = genaiFromSession(session, ort, opts);
    if (opts.warmupToken !== void 0) await be.prefill([opts.warmupToken], { positions: [] });
    return be;
  } catch (e) {
    try {
      await session.release?.();
    } catch {
    }
    throw e;
  }
}

// src/backends/decodeOnly.ts
var F162 = globalThis.Float16Array;
async function createDecodeOnly(session, opts) {
  if (!(opts?.eos instanceof Set) || !opts.eos.size) throw new Error("decode-only: opts.eos (Set of EOS ids from the manifest) is required");
  if (!opts.skipVersionCheck) checkOrtVersion(opts.ort.env?.versions?.web);
  const T2 = opts.ort.Tensor, eos = opts.eos;
  const pastLen = opts.pastLen ?? 1;
  const inNames = session.inputNames, outNames = session.outputNames;
  if (inNames.includes("attention_mask")) throw new Error("decode-only: a graph with attention_mask is not decode-only");
  const metaBy = inputMeta(session);
  const specs = [];
  for (const n of inNames) {
    if (n === "input_ids" || n === "cache_position") continue;
    const m = metaBy.get(n);
    if (!m?.shape) throw new Error("decode-only: no shape metadata for input " + n);
    specs.push({ name: n, type: m.type, dims: cacheDims(n, m.shape, pastLen) });
  }
  const pastOf = /* @__PURE__ */ new Map();
  for (const o of outNames) {
    const p = pastNameFor(o);
    if (p && inNames.includes(p)) pastOf.set(o, p);
  }
  const missing = specs.filter((s) => ![...pastOf.values()].includes(s.name));
  if (missing.length) throw new Error("decode-only: cache inputs without a matching present output: " + missing.slice(0, 3).map((s) => s.name).join(", "));
  const hiddenName = resolveHidden("decode-only", outNames, opts.hiddenOutput);
  const extraName = resolveHidden("decode-only", outNames, opts.forecastOutput);
  const hasCachePos = inNames.includes("cache_position");
  const zeros = (s) => {
    const n = s.dims.reduce((a, b) => a * b, 1);
    if (s.type === "float32") return new T2("float32", new Float32Array(n), s.dims);
    if (s.type === "float16") return new T2("float16", F162 ? new F162(n) : new Uint16Array(n), s.dims);
    throw new Error(`decode-only: unsupported cache dtype: ${s.type} (${s.name})`);
  };
  const initState = () => {
    const st = {};
    for (const s of specs) st[s.name] = zeros(s);
    return st;
  };
  const fetchBase = ["logits", ...pastOf.keys()];
  async function step(tid, pos, st, wantHidden, wantExtra = false) {
    const feed2 = { input_ids: new T2("int64", BigInt64Array.from([BigInt(tid)]), [1, 1]), ...st };
    if (hasCachePos) feed2.cache_position = new T2("int64", BigInt64Array.from([BigInt(pos)]), [1]);
    const names = [...fetchBase, ...wantHidden && hiddenName ? [hiddenName] : [], ...wantExtra && extraName ? [extraName] : []];
    const r = await session.run(feed2, names);
    const ns = {};
    for (const [o, p] of pastOf) ns[p] = r[o];
    const hidden = wantHidden && hiddenName ? tensorToF32(r[hiddenName].data, r[hiddenName].type) : void 0;
    const extra = wantExtra && extraName ? tensorToF32(r[extraName].data, r[extraName].type) : void 0;
    if (extra) assertFiniteRow("decode-only", extraName, extra);
    return { logits: r.logits, st: ns, hidden, extra };
  }
  const snaps = /* @__PURE__ */ new WeakMap();
  const handle = (ids, st) => {
    const h = { ids: ids.slice(), dispose() {
      snaps.delete(h);
    } };
    snaps.set(h, st);
    return h;
  };
  async function feed(ids, from, st, positions, keep, extraPos = []) {
    const wanted = new Set(positions), at = /* @__PURE__ */ new Map(), wantedX = new Set(extraPos), atX = /* @__PURE__ */ new Map();
    let last = null;
    for (let i = from; i < ids.length; i++) {
      const r = await step(ids[i], i, st, wanted.has(i), wantedX.has(i));
      st = r.st;
      last = r.logits;
      if (r.hidden) at.set(i, r.hidden);
      if (r.extra) atX.set(i, r.extra);
    }
    const res = { hiddens: positions.map((p) => at.get(p)), lastLogits: lastRow(last) };
    if (extraPos.length) res.extra = extraPos.map((p) => atX.get(p));
    if (keep) res.state = handle(ids, st);
    return res;
  }
  const checkHidden = (positions) => {
    if (positions.length && !hiddenName) throw new Error("decode-only: this build has no hidden output; use method 'logits'");
  };
  const checkExtra = (want) => {
    if (want.extra?.positions.length && !extraName) throw new Error("forecast unsupported: this decode-only build exposes no forecast layer (set build.forecastOutput)");
  };
  const stateOf = (h) => {
    const st = snaps.get(h);
    if (!st) throw new Error("decode-only: unknown or released state handle");
    return st;
  };
  async function* decodeLoop(ids, from, st0, o) {
    const g = resolveGenerateOptions(o);
    const rand = mulberry32(g.seed);
    if (g.maxNewTokens === 0) return;
    const rel = await gate.acquire();
    try {
      let st = st0, last = null, pos = from;
      for (; pos < ids.length; pos++) {
        if (g.signal?.aborted) return;
        ({ logits: last, st } = await step(ids[pos], pos, st, false));
      }
      const gen = [];
      for (let s = 0; s < g.maxNewTokens; s++) {
        if (g.signal?.aborted) break;
        const tid = sample(lastRow(last), gen, rand, g);
        if (eos.has(tid)) break;
        gen.push(tid);
        yield tid;
        if (s + 1 >= g.maxNewTokens || g.signal?.aborted) break;
        ({ logits: last, st } = await step(tid, pos, st, false));
        pos++;
      }
    } finally {
      rel();
    }
  }
  const gate = createGate("decode-only");
  return {
    kind: "decode-only",
    hiddenName,
    extraName,
    dispose() {
      return gate.dispose(() => session.release?.());
    },
    async prefill(ids, want, o = {}) {
      gate.assertLive();
      checkHidden(want.positions);
      checkPositions("decode-only", ids, [...want.positions, ...want.extra?.positions ?? []]);
      checkExtra(want);
      const rel = await gate.acquire();
      try {
        return await feed(ids, 0, initState(), want.positions, o.keep, want.extra?.positions);
      } finally {
        rel();
      }
    },
    async snapshot(ids) {
      gate.assertLive();
      if (!ids.length) throw new Error("decode-only: snapshot of empty ids");
      const rel = await gate.acquire();
      try {
        let st = initState();
        for (let i = 0; i < ids.length; i++) st = (await step(ids[i], i, st, false)).st;
        return handle(ids, st);
      } finally {
        rel();
      }
    },
    async prefillFrom(h, ids, want, o = {}) {
      gate.assertLive();
      const st = stateOf(h);
      const k = checkContinuation("decode-only", h, ids, [...want.positions, ...want.extra?.positions ?? []]);
      checkHidden(want.positions);
      checkExtra(want);
      const rel = await gate.acquire();
      try {
        return await feed(ids, k, st, want.positions, o.keep, want.extra?.positions);
      } finally {
        rel();
      }
    },
    async *generate(ids, o) {
      gate.assertLive();
      if (!ids.length) throw new Error("generate: empty ids");
      yield* decodeLoop(ids, 0, initState(), o);
    },
    async *generateFrom(h, ids, o) {
      gate.assertLive();
      const st = stateOf(h);
      const k = checkContinuation("decode-only", h, ids, []);
      yield* decodeLoop(ids, k, st, o);
    }
  };
}

// src/backends/transformersjs.ts
function transformersJsFromModel(model, Tensor, opts) {
  if (!(opts?.eos instanceof Set) || !opts.eos.size) throw new Error("transformers.js: opts.eos (Set of EOS ids from the manifest) is required");
  const eos = opts.eos;
  const sess = model.sessions?.model ?? Object.values(model.sessions ?? {})[0];
  const hiddenName = resolveHidden("transformers.js", sess?.outputNames ?? [], opts.hiddenOutput);
  const extraName = resolveHidden("transformers.js", sess?.outputNames ?? [], opts.forecastOutput);
  const toTensors = (ids) => ({
    input_ids: new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    attention_mask: new Tensor("int64", new BigInt64Array(ids.length).fill(1n), [1, ids.length])
  });
  const gate = createGate("transformers.js");
  return {
    kind: "transformers.js",
    hiddenName,
    extraName,
    async prefill(ids, want) {
      gate.assertLive();
      checkPositions("transformers.js", ids, [...want.positions, ...want.extra?.positions ?? []]);
      if (want.extra?.positions.length && !extraName) throw new Error("forecast unsupported: this transformers.js build exposes no forecast layer (set build.forecastOutput)");
      if (want.positions.length && !hiddenName) throw new Error("transformers.js: this build has no hidden output; use method 'logits'");
      const rel = await gate.acquire();
      try {
        const out = await model.forward(toTensors(ids));
        const L = out.logits, V = L.dims.at(-1);
        const lastLogits = tensorToF32(L.data, L.type, (L.dims.at(-2) - 1) * V, V);
        const hiddens = [];
        if (want.positions.length) {
          const H = out[hiddenName], D = H.dims.at(-1);
          if (H.dims.at(-2) !== ids.length) throw new Error(`transformers.js: hidden seq ${H.dims.at(-2)} != ${ids.length}`);
          for (const p of want.positions) hiddens.push(tensorToF32(H.data, H.type, p * D, D));
        }
        const res = { hiddens, lastLogits };
        if (want.extra?.positions.length) {
          const X = out[extraName], D = X.dims.at(-1);
          if (X.dims.at(-2) !== ids.length) throw new Error(`transformers.js: forecast seq ${X.dims.at(-2)} != ${ids.length}`);
          res.extra = want.extra.positions.map((p) => {
            const row = tensorToF32(X.data, X.type, p * D, D);
            assertFiniteRow("transformers.js", extraName, row);
            return row;
          });
        }
        return res;
      } finally {
        rel();
      }
    },
    dispose() {
      return gate.dispose(() => model.dispose?.());
    },
    async *generate(ids, o) {
      gate.assertLive();
      const g = resolveGenerateOptions(o);
      const max = g.maxNewTokens, temp = g.temperature;
      if (!ids.length) throw new Error("generate: empty ids");
      if (max === 0) return;
      const rel = await gate.acquire();
      const queue = [];
      let done = false, wake = null, err = null, first = true, stop = false;
      const ping = () => {
        const w = wake;
        wake = null;
        w?.();
      };
      const streamer = {
        put(v) {
          if (first) {
            first = false;
            return;
          }
          if (stop) return;
          for (const t of v.flat ? v.flat() : v) queue.push(Number(t));
          ping();
        },
        end() {
          done = true;
          ping();
        }
      };
      const criterion = (batch) => batch.map(() => stop || !!o.signal?.aborted);
      const args = { ...toTensors(ids), max_new_tokens: max, streamer, stopping_criteria: [criterion], do_sample: temp > 0, repetition_penalty: g.repetitionPenalty };
      if (temp > 0) {
        args.temperature = temp;
        args.top_p = g.topP;
        args.top_k = g.topK;
      }
      const run = Promise.resolve().then(() => model.generate(args)).then(() => {
        done = true;
        ping();
      }, (e) => {
        err = e;
        done = true;
        ping();
      });
      let emitted = 0;
      try {
        while (true) {
          if (o.signal?.aborted) break;
          if (queue.length) {
            const t = queue.shift();
            if (eos.has(t)) break;
            yield t;
            if (++emitted >= max) break;
          } else if (done) break;
          else await new Promise((r) => {
            wake = r;
            if (queue.length || done) ping();
          });
        }
      } finally {
        stop = true;
        try {
          await run;
        } finally {
          rel();
        }
      }
      if (err && !o.signal?.aborted) throw err;
    }
  };
}

// src/backends/webllm.ts
function logitCapture() {
  let armed = false, cap = null, sampled = [];
  return {
    processor: {
      processLogits(l) {
        if (armed) {
          cap = new Float32Array(l);
          armed = false;
        }
        return l;
      },
      processSampledToken(t) {
        sampled.push(t);
      },
      resetState() {
      }
    },
    arm() {
      armed = true;
      cap = null;
    },
    take() {
      const c = cap;
      cap = null;
      armed = false;
      return c;
    },
    drain() {
      const s = sampled;
      sampled = [];
      return s;
    },
    reset() {
      armed = false;
      cap = null;
      sampled = [];
    }
  };
}
function normalizeRecovery(r) {
  const N = r.rows.length;
  if (!N || r.P.length % N) throw new Error(`webllm: P (${r.P.length}) is not a multiple of rows (${N})`);
  let P;
  if (r.P instanceof Uint16Array) {
    P = new Float32Array(r.P.length);
    for (let i = 0; i < P.length; i++) P[i] = halfToNumber(r.P[i]);
  } else P = r.P;
  return { rows: r.rows, P, D: P.length / N };
}
function recoverHidden(rec, logits) {
  const r = "D" in rec ? rec : normalizeRecovery(rec);
  const N = r.rows.length, sub = new Float32Array(N), h = new Float32Array(r.D);
  for (let n = 0; n < N; n++) sub[n] = logits[r.rows[n]];
  for (let d = 0; d < r.D; d++) {
    let acc = 0;
    const off = d * N;
    for (let n = 0; n < N; n++) acc += r.P[off + n] * sub[n];
    h[d] = acc;
  }
  return h;
}
async function loadRecovery(rowsUrl, pUrl, format = pUrl.endsWith(".f16") ? "f16" : "f32", fetchFn = fetch) {
  const [rb, pb] = await Promise.all([
    fetchFn(rowsUrl).then((r) => {
      if (!r.ok) throw new Error("webllm: " + rowsUrl + " " + r.status);
      return r.arrayBuffer();
    }),
    fetchFn(pUrl).then((r) => {
      if (!r.ok) throw new Error("webllm: " + pUrl + " " + r.status);
      return r.arrayBuffer();
    })
  ]);
  return { rows: new Int32Array(rb), P: format === "f16" ? new Uint16Array(pb) : new Float32Array(pb) };
}
function webllmBackend(engine, capture, opts) {
  if (!opts.tok?.decode) throw new Error("webllm: opts.tok (tokenizer with decode) is required; WebLLM only accepts text");
  if (!(opts.eos instanceof Set) || !opts.eos.size) throw new Error("webllm: opts.eos (Set of EOS ids from the manifest) is required");
  const eos = opts.eos;
  let rec = opts.recovery ? normalizeRecovery(opts.recovery) : null;
  const gate = gateFor(engine, "webllm");
  const decode = (ids) => opts.tok.decode(ids, { skipSpecial: false });
  async function logitsAt(ids, k) {
    await engine.resetChat();
    capture.reset();
    capture.arm();
    const r = await engine.completions.create({ prompt: decode(ids.slice(0, k + 1)), max_tokens: 1, temperature: 0 });
    const L = capture.take();
    if (!L) throw new Error("webllm: the LogitProcessor captured no logits (engine created without this capture's logitProcessorRegistry, or a Web Worker?)");
    const n = r?.usage?.prompt_tokens;
    if (n !== void 0 && n !== k + 1) throw new Error(`webllm: the prompt truncated at position ${k} re-tokenized to ${n} tokens (expected ${k + 1}); the position read would be wrong`);
    return L;
  }
  return {
    kind: "webllm",
    hiddenName: rec ? "recovered-from-logits" : null,
    dispose() {
      return gate.dispose(async () => {
        rec = null;
        await engine.unload?.();
      });
    },
    async prefill(ids, want) {
      if (want.extra?.positions.length) throw new Error("forecast unsupported: webllm builds return logits only and have no intermediate-layer output");
      gate.assertLive();
      checkPositions("webllm", ids, want.positions);
      if (want.positions.length && !rec) throw new Error("webllm: without opts.recovery the backend cannot recover hidden states; use method 'logits'");
      const rel = await gate.acquire();
      try {
        const last = ids.length - 1;
        const lastLogits = await logitsAt(ids, last);
        const at = /* @__PURE__ */ new Map();
        for (const p of new Set(want.positions)) at.set(p, recoverHidden(rec, p === last ? lastLogits : await logitsAt(ids, p)));
        return { hiddens: want.positions.map((p) => at.get(p).slice()), lastLogits };
      } finally {
        rel();
      }
    },
    async *generate(ids, o) {
      gate.assertLive();
      const g = resolveGenerateOptions(o);
      if (!ids.length) throw new Error("generate: empty ids");
      if (g.maxNewTokens === 0) return;
      const rel = await gate.acquire();
      let iter = null, finished = false;
      try {
        if (o.signal?.aborted) return;
        await engine.resetChat();
        capture.reset();
        const stream = await engine.completions.create({
          prompt: decode(ids),
          stream: true,
          max_tokens: g.maxNewTokens,
          temperature: g.temperature,
          top_p: g.topP,
          seed: g.seed,
          repetition_penalty: g.repetitionPenalty
        });
        iter = stream[Symbol.asyncIterator]();
        let n = 0, stop = false;
        while (!stop) {
          if (o.signal?.aborted) break;
          const nx = await iter.next();
          const toks = capture.drain();
          if (nx.done) finished = true;
          for (const t of toks) {
            if (eos.has(t)) {
              stop = true;
              break;
            }
            if (n >= g.maxNewTokens) {
              stop = true;
              break;
            }
            n++;
            yield t;
            if (o.signal?.aborted) {
              stop = true;
              break;
            }
          }
          if (nx.done) break;
        }
      } finally {
        if (iter) {
          try {
            if (!finished) {
              await engine.interruptGenerate();
              for (let i = 0; i < 1e5; i++) {
                const nx = await iter.next();
                if (nx.done) break;
              }
            }
          } catch {
          }
          try {
            await iter.return?.();
          } catch {
          }
        }
        capture.reset();
        rel();
      }
    }
  };
}
async function createWebllm(webllm, opts) {
  const capture = logitCapture();
  const appConfig = opts.appConfig ?? { model_list: [{ model: opts.modelUrl, model_id: opts.modelId, model_lib: opts.libUrl }] };
  const recovery = opts.recovery ?? (opts.recoveryUrls ? await loadRecovery(opts.recoveryUrls.rows, opts.recoveryUrls.P, opts.recoveryUrls.format) : void 0);
  const engine = await webllm.CreateMLCEngine(opts.modelId, {
    appConfig,
    logitProcessorRegistry: /* @__PURE__ */ new Map([[opts.modelId, capture.processor]]),
    initProgressCallback: opts.initProgressCallback
  });
  return Object.assign(webllmBackend(engine, capture, { tok: opts.tok, recovery, eos: opts.eos }), { engine, capture });
}

// src/backends/litert.ts
var LITERTJS_VERSION = "2.6.0";
var LITERT_WARNING = `runtime "litert" is opt-in (LiteRT.js @litertjs/core ${LITERTJS_VERSION}, WebGPU with streamed weights; slower per decision than "genai"). Pass quiet: true to silence this note.`;
function embedFromQ8(q8, scale, hidden) {
  const q = q8 instanceof Int8Array ? q8 : new Int8Array(q8.buffer, q8.byteOffset, q8.byteLength);
  return {
    async rows(ids) {
      const out = new Float32Array(ids.length * hidden);
      ids.forEach((id, r) => {
        const s = scale[id], o = id * hidden;
        for (let j = 0; j < hidden; j++) out[r * hidden + j] = q[o + j] * s;
      });
      return out;
    }
  };
}
function h2f2(h) {
  const s = h & 32768 ? -1 : 1, e = h >> 10 & 31, f = h & 1023;
  return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? f ? NaN : s * Infinity : s * 2 ** (e - 15) * (1 + f / 1024);
}
function embedFromF16Reader(read, hidden) {
  return {
    async rows(ids) {
      const out = new Float32Array(ids.length * hidden), got = /* @__PURE__ */ new Map();
      await Promise.all([...new Set(ids)].map(async (id) => {
        const b = await read(id * hidden * 2, hidden * 2);
        const c = b.byteOffset % 2 ? b.slice() : b;
        got.set(id, new Uint16Array(c.buffer, c.byteOffset, hidden));
      }));
      ids.forEach((id, r) => {
        const q = got.get(id);
        for (let j = 0; j < hidden; j++) out[r * hidden + j] = h2f2(q[j]);
      });
      return out;
    }
  };
}
function httpRangeReader(url, fetchFn = fetch) {
  return async (offset, length) => {
    const r = await fetchFn(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (!r.ok) throw new Error(`litert: ${url} -> HTTP ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    return r.status === 206 ? b : b.subarray(offset, offset + length);
  };
}
var MASK_OFF = -1e30;
function buildMask(pos, cache, dtype) {
  const rows = pos.length;
  if (dtype === "bool") {
    const m2 = new Uint8Array(rows * cache);
    for (let r = 0; r < rows; r++) m2.fill(1, r * cache, r * cache + pos[r] + 1);
    return m2;
  }
  const m = new Float32Array(rows * cache).fill(MASK_OFF);
  for (let r = 0; r < rows; r++) m.fill(0, r * cache, r * cache + pos[r] + 1);
  return m;
}
function prefillChunks(n, P) {
  const out = [];
  for (let s = 0; s < n; s += P) out.push({ start: s, len: Math.min(P, n - s) });
  return out;
}
var isState = (n) => n.startsWith("kv_cache_");
var zerosOf = (io) => {
  const n = io.shape.reduce((a, b) => a * b, 1);
  return io.dtype === "int32" ? new Int32Array(n) : new Float32Array(n);
};
async function createLiteRt(lrt, graph, manifest, embed, opts) {
  if (!(opts?.eos instanceof Set) || !opts.eos.size) throw new Error("litert: opts.eos (Set of EOS ids from the manifest) is required");
  const EOS = opts.eos;
  if (!opts.quiet) console.warn(LITERT_WARNING);
  const accelerator = opts.accelerator ?? "webgpu";
  const sigNames = Object.keys(manifest.signatures);
  const prefillName = sigNames.filter((s) => /^prefill_\d+$/.test(s)).sort((a, b) => +b.split("_")[1] - +a.split("_")[1])[0];
  if (!prefillName || !manifest.signatures.decode) throw new Error(`litert: the graph needs prefill_<N> and decode signatures (has ${sigNames.join(", ")})`);
  const P = +prefillName.split("_")[1];
  const dec = manifest.signatures.decode;
  const stateIO = dec.inputs.filter((i) => isState(i.name));
  const maskIO = dec.inputs.find((i) => i.name === "mask");
  if (!maskIO) throw new Error("litert: decode signature has no mask input");
  const cache = maskIO.shape[maskIO.shape.length - 1];
  const H = manifest.hidden;
  const paramIO = dec.inputs.find((i) => i.name === "param_tensor");
  const inplace = !!paramIO;
  let hiddenOut = null;
  if (opts.hiddenOutput != null) {
    if (!dec.outputs.some((o) => o.name === opts.hiddenOutput)) throw new Error(`litert: manifest hiddenOutput ${JSON.stringify(opts.hiddenOutput)} is not a decode output (${dec.outputs.map((o) => o.name).filter((n) => !isState(n)).join(", ")})`);
    hiddenOut = opts.hiddenOutput;
  }
  const gpuOptions = { precision: opts.gpuPrecision ?? "fp32" };
  const copyState = opts.copyState ?? accelerator === "webgpu";
  const model = accelerator === "webgpu" && opts.weights ? await lrt.loadModelAndWeights(graph, { getReader: () => opts.weights().getReader() }, { accelerator: "webgpu", gpuOptions }) : await lrt.loadAndCompile(graph, accelerator === "webgpu" ? { accelerator, gpuOptions } : { accelerator });
  const T2 = (data, shape, dtype) => dtype ? new lrt.Tensor(data, shape, dtype) : new lrt.Tensor(data, shape);
  const del = (t) => {
    try {
      t?.delete?.();
    } catch {
    }
  };
  const zeroStateHost = () => {
    const st = {};
    for (const io of stateIO) st[io.name] = T2(zerosOf(io), io.shape);
    return st;
  };
  async function freshState() {
    const st = zeroStateHost();
    if (inplace && accelerator === "webgpu") for (const k in st) {
      const g = await st[k].moveTo("webgpu");
      st[k] = g;
    }
    return st;
  }
  const freeState = (st) => {
    for (const k in st) del(st[k]);
  };
  async function run(sig, emb, rows, pos, st, valid = rows) {
    const feed = { ...st, embeddings: T2(emb, [1, rows, H]), input_pos: T2(pos, [rows]), mask: T2(buildMask(pos, cache, maskIO.dtype), [1, 1, rows, cache], maskIO.dtype === "bool" ? "bool" : void 0) };
    if (paramIO) {
      const p = new Int32Array(paramIO.shape.reduce((a, b) => a * b, 1));
      p[0] = pos[0];
      p[1] = pos[0] + valid;
      p[2] = pos[0] + valid;
      feed.param_tensor = T2(p, paramIO.shape);
    }
    const out = await model.run(sig, feed);
    del(feed.embeddings);
    del(feed.input_pos);
    del(feed.mask);
    del(feed.param_tensor);
    const hidden = hiddenOut ? out[hiddenOut] : void 0;
    const handed = /* @__PURE__ */ new Set([out.logits, hidden]);
    if (inplace) {
      for (const k in out) if (!handed.has(out[k]) && !isState(k)) del(out[k]);
      return { st, logits: out.logits, hidden };
    }
    const ns = {};
    for (const io of stateIO) {
      const t = out[io.name];
      if (!t) throw new Error(`litert: ${sig} did not return ${io.name}`);
      if (copyState && t.copyTo) {
        ns[io.name] = await t.copyTo("wasm");
        del(t);
      } else ns[io.name] = t;
      handed.add(t);
    }
    for (const k in out) if (!handed.has(out[k])) del(out[k]);
    freeState(st);
    return { st: ns, logits: out.logits, hidden };
  }
  async function readLogits(L) {
    const c = L.moveTo ? await L.moveTo("wasm") : L;
    const a = Float32Array.from(c.toTypedArray());
    if (c !== L) del(c);
    del(L);
    return a.subarray(a.length - manifest.vocab);
  }
  async function collectHidden(hid, firstPos, rows, want, at) {
    if (!hid || !want.size) {
      del(hid);
      return;
    }
    const c = hid.moveTo ? await hid.moveTo("wasm") : hid;
    const a = c.toTypedArray();
    for (let r = 0; r < rows; r++) {
      const p = firstPos + r;
      if (want.has(p)) at.set(p, Float32Array.from(a.subarray(r * H, r * H + H)));
    }
    if (c !== hid) del(c);
    del(hid);
  }
  async function prefillTokens(ids, from, end, st, want, at) {
    const grab = async (r, firstPos, rows) => {
      if (want && at) await collectHidden(r.hidden, firstPos, rows, want, at);
      else del(r.hidden);
    };
    if (opts.decodeOnlyPrefill) {
      for (let i = from; i < end; i++) {
        const r = await run("decode", await embed.rows([ids[i]]), 1, Int32Array.from([i]), st);
        st = r.st;
        del(r.logits);
        await grab(r, i, 1);
      }
      return st;
    }
    const remDec = opts.remainderViaDecode ?? accelerator === "webgpu";
    for (const c of prefillChunks(end - from, P)) {
      if (remDec && c.len < P) {
        for (let i = from + c.start; i < from + c.start + c.len; i++) {
          const r2 = await run("decode", await embed.rows([ids[i]]), 1, Int32Array.from([i]), st);
          st = r2.st;
          del(r2.logits);
          await grab(r2, i, 1);
        }
        continue;
      }
      const toks = ids.slice(from + c.start, from + c.start + c.len);
      const emb = new Float32Array(P * H);
      emb.set(await embed.rows(toks));
      const pos = new Int32Array(P);
      for (let i = 0; i < c.len; i++) pos[i] = from + c.start + i;
      const r = await run(prefillName, emb, P, pos, st, c.len);
      st = r.st;
      del(r.logits);
      await grab(r, from + c.start, c.len);
    }
    return st;
  }
  async function decodeOne(tid, p, st) {
    const r = await run("decode", await embed.rows([tid]), 1, Int32Array.from([p]), st);
    return { st: r.st, logits: await readLogits(r.logits), hidden: r.hidden };
  }
  async function feedFrom(ids, from, st, positions, keep) {
    const want = new Set(positions);
    const at = /* @__PURE__ */ new Map();
    const last = ids.length - 1;
    st = await prefillTokens(ids, from, last, st, want, at);
    const r = await decodeOne(ids[last], last, st);
    await collectHidden(r.hidden, last, 1, want, at);
    const res = { lastLogits: r.logits, hiddens: positions.map((p) => at.get(p)) };
    if (keep) res.state = handle(ids, await snapshotState(r.st));
    freeState(r.st);
    return res;
  }
  const handle = (ids, arrs) => {
    const h = { ids: ids.slice(), dispose() {
      snaps.delete(h);
    } };
    snaps.set(h, arrs);
    return h;
  };
  async function* decodeLoop(ids, from, st0, o) {
    const g = resolveGenerateOptions(o), rand = mulberry32(g.seed);
    if (g.maxNewTokens === 0) {
      freeState(st0);
      return;
    }
    const rel = await gate.acquire();
    let st = st0;
    try {
      st = await prefillTokens(ids, from, ids.length - 1, st);
      let r = await decodeOne(ids[ids.length - 1], ids.length - 1, st);
      st = r.st;
      del(r.hidden);
      const gen = [];
      for (let s = 0, pos = ids.length; s < g.maxNewTokens; s++, pos++) {
        if (g.signal?.aborted || pos >= cache) break;
        const tid = sample(r.logits, gen, rand, g);
        if (EOS.has(tid)) break;
        gen.push(tid);
        yield tid;
        if (s + 1 >= g.maxNewTokens || g.signal?.aborted) break;
        r = await decodeOne(tid, pos, st);
        st = r.st;
        del(r.hidden);
      }
    } finally {
      if (st) freeState(st);
      rel();
    }
  }
  const checkHidden = (want) => {
    if (want.positions.length && !hiddenOut) throw new Error('litert: this graph has no hidden-state output; use ask() with method "logits"');
  };
  const gate = createGate("litert");
  const snaps = /* @__PURE__ */ new WeakMap();
  const snapshotState = async (st) => Promise.all(stateIO.map(async (io) => {
    const t = st[io.name];
    const c = t.moveTo ? await t.moveTo("wasm") : t;
    const a = Float32Array.from(c.toTypedArray());
    if (c !== t) del(c);
    return a;
  }));
  const fromCopy = async (arrs) => {
    const st = {};
    stateIO.forEach((io, i) => {
      st[io.name] = T2(arrs[i].slice(), io.shape);
    });
    if (inplace && accelerator === "webgpu") for (const k in st) st[k] = await st[k].moveTo("webgpu");
    return st;
  };
  return {
    kind: "litert",
    hiddenName: hiddenOut,
    dispose() {
      return gate.dispose(() => model.delete?.());
    },
    async prefill(ids, want, o = {}) {
      if (want.extra?.positions.length) throw new Error("forecast unsupported: litert builds return logits only and have no intermediate-layer output");
      gate.assertLive();
      checkHidden(want);
      if (!ids.length) throw new Error("prefill: empty ids");
      const rel = await gate.acquire();
      try {
        return await feedFrom(ids, 0, await freshState(), want.positions, o.keep);
      } finally {
        rel();
      }
    },
    async snapshot(ids) {
      gate.assertLive();
      if (!ids.length) throw new Error("litert: snapshot of empty ids");
      const rel = await gate.acquire();
      try {
        const st = await prefillTokens(ids, 0, ids.length, await freshState());
        const h = handle(ids, await snapshotState(st));
        freeState(st);
        return h;
      } finally {
        rel();
      }
    },
    async prefillFrom(h, ids, want, o = {}) {
      if (want.extra?.positions.length) throw new Error("forecast unsupported: litert builds return logits only and have no intermediate-layer output");
      gate.assertLive();
      checkHidden(want);
      const arrs = snaps.get(h);
      if (!arrs) throw new Error("litert: unknown or released snapshot handle");
      const k = checkContinuation("litert", h, ids, want.positions);
      const rel = await gate.acquire();
      try {
        return await feedFrom(ids, k, await fromCopy(arrs), want.positions, o.keep);
      } finally {
        rel();
      }
    },
    async *generate(ids, o) {
      gate.assertLive();
      if (!ids.length) throw new Error("generate: empty ids");
      yield* decodeLoop(ids, 0, await freshState(), o);
    },
    async *generateFrom(h, ids, o) {
      gate.assertLive();
      const arrs = snaps.get(h);
      if (!arrs) throw new Error("litert: unknown or released snapshot handle");
      const k = checkContinuation("litert", h, ids, []);
      yield* decodeLoop(ids, k, await fromCopy(arrs), o);
    }
  };
}

// src/model.ts
var NODE_ORT = "onnxruntime-node";
var WEBLLM_PKG = "@mlc-ai/web-llm";
var LITERT_PKG = "@litertjs/core";
var TJS_PKG = "@huggingface/transformers";
var dynImport = (s) => import(
  /* @vite-ignore */
  s
);
async function readManifest(src, platform, f) {
  if (typeof src !== "string") return validateManifest(src);
  if (platform === "node" && !/^https?:/.test(src)) {
    const fs = await dynImport("node:fs"), url = await dynImport("node:url");
    return validateManifest(JSON.parse(fs.readFileSync(src.startsWith("file:") ? url.fileURLToPath(src) : src, "utf8")));
  }
  const r = await f(src);
  if (!r.ok) throw new Error(`manifest ${src}: HTTP ${r.status}`);
  return validateManifest(await r.json());
}
var S1S2 = class _S1S2 {
  manifest;
  build;
  runtime;
  device;
  /** Why "auto" did not use its first candidate, or why it runs on the browser CPU ("wasm") without being asked to. */
  fallbackReason;
  engine;
  buildLoader;
  escalationBuilds = /* @__PURE__ */ new Map();
  constructor(m, plan, engine) {
    this.manifest = m;
    this.build = plan.build;
    this.runtime = plan.runtime;
    this.device = plan.device;
    this.engine = { ...engine, build: plan.build, resolveBuild: (b) => this.escalationBuild(b) };
  }
  /** How `to: { build }` escalation loads another build (default after S1S2.load: S1S2.load with the same options
   *  and that build). Each build is loaded once, on first use, and disposed with this instance. A second graph in
   *  memory is a real cost (an int8 graph is about twice the int4 one). */
  withBuildLoader(load) {
    this.buildLoader = load;
    return this;
  }
  /** The instance used for escalation to `build` (loaded on first use). */
  escalationBuild(build) {
    if (build === this.build) return Promise.reject(new Error(`margin policy: escalation target "${build}" is the build already answering`));
    if (!this.manifest.builds[build]) return Promise.reject(new Error(`margin policy: unknown build "${build}"`));
    let p = this.escalationBuilds.get(build);
    if (!p) {
      if (!this.buildLoader) return Promise.reject(new Error(`margin policy: no loader for build "${build}" (S1S2.fromBackend: call withBuildLoader)`));
      p = this.buildLoader(build);
      p.catch(() => this.escalationBuilds.delete(build));
      this.escalationBuilds.set(build, p);
    }
    return p;
  }
  /** Whether session.generate() continues from the decision prefill on this backend. */
  get sharedPrefill() {
    return canShareState(this.engine.backend);
  }
  get hiddenOutput() {
    return this.engine.backend.hiddenName;
  }
  get maxSafeTokens() {
    return this.engine.maxSafeTokens;
  }
  get backend() {
    return this.engine.backend;
  }
  get tokenizer() {
    return this.engine.tok;
  }
  /** Question types (and "evidence") with a loaded head. */
  get heads() {
    return Object.keys(this.engine.heads);
  }
  countTokens(text) {
    return this.engine.tok.encode(text).length;
  }
  /** System 1: typed decisions in one forward pass per question. Returns answers + a session for System 2. */
  decide(req, opts) {
    return decide(this.engine, req, opts);
  }
  /** Forecast reader (experimental, spec/FORECAST.md): decide() with the forecast layer read in the same prefill, then the
   *  forecast of the first question (or `opts.question`). Returns the session too, so generate() continues from the same
   *  prefill; dispose it when done. */
  async forecast(req, opts = {}) {
    const session = await decide(this.engine, req, { ...opts, forecast: true });
    try {
      return { forecast: session.forecast({ question: opts.question }), session };
    } catch (e) {
      await session.dispose();
      throw e;
    }
  }
  /** Behaviors the forecast reader returns, or null when this model/build has none (see forecastUnavailable). */
  get forecastBehaviors() {
    return this.engine.forecast?.spec.behaviors.map((b) => b.name) ?? null;
  }
  /** Why the forecast reader is not available ("forecast unsupported: ..."), or null when it is. */
  get forecastUnavailable() {
    return this.engine.forecast ? null : this.engine.forecastWhy ?? null;
  }
  /** System 2: generation for one user turn. */
  generate(prompt, opts) {
    return generate(this.engine, prompt, opts);
  }
  async dispose() {
    const extra = [...this.escalationBuilds.values()];
    this.escalationBuilds.clear();
    for (const p of extra) {
      try {
        await (await p).dispose();
      } catch {
      }
    }
    await this.engine.backend.dispose();
  }
  /** Build an instance around an existing backend + tokenizer (tests, custom runtimes). */
  static fromBackend(manifest, build, backend, tok, heads = {}, device = "cpu", maxSafeTokens, norm, forecast) {
    const m = validateManifest(manifest);
    assertS1Layer(m);
    const b = m.builds[build];
    if (!b) throw new Error(`unknown build "${build}"`);
    assertManifestTokens(tok, m);
    for (const [t, h] of Object.entries(heads)) {
      const hs = h && ("cfg" in h ? h.cfg.hidden_size : h.hiddenSize);
      if (h && hs !== m.hiddenSize) throw new Error(`head for ${t}: hiddenSize ${hs} != manifest ${m.hiddenSize}`);
    }
    return new _S1S2(m, { build, runtime: b.runtime, device }, { manifest: m, tok, backend, heads, norm, maxSafeTokens: maxSafeTokens ?? b.maxSafeTokens ?? m.defaults.maxSafeTokens ?? 2048, ...forecastState(m, b, backend, forecast) });
  }
  static async load(opts) {
    const status = opts.onStatus ?? (() => {
    });
    const platform = detectPlatform();
    const f = opts.fetch ?? ((...a) => fetch(...a));
    const m = await readManifest(opts.manifest, platform, f);
    assertS1Layer(m);
    const files = new Files({ platform, cacheDir: opts.cacheDir, localDirs: opts.localDirs, baseUrls: opts.baseUrls, allowUnverified: opts.allowUnverified, fetch: opts.fetch, onStatus: status });
    const mods = opts.modules ?? {};
    const gpu = platform === "browser" ? await webgpuStatus() : { ok: false, reason: void 0 };
    const webgpu = gpu.ok;
    let ort = mods.ort ?? null, cuda = false;
    const wantsOrt = (r) => !r || r === "auto" || r === "genai" || r === "decode-only";
    const req = opts.build ? m.builds[opts.build]?.runtime : opts.runtime;
    if (platform === "node" && (wantsOrt(req) || opts.device === "cuda")) {
      try {
        ort ??= await importOptional(NODE_ORT, () => dynImport(NODE_ORT), "ONNX Runtime in Node");
        cuda = detectCuda(ort);
      } catch (e) {
        if (req === "genai" || req === "decode-only") throw e;
      }
    }
    const caps = { platform, webgpu, cuda, webgpuReason: gpu.reason };
    const plans = planBuilds(m, { build: opts.build, runtime: opts.runtime, device: opts.device, cpuFallback: opts.cpuFallback }, caps);
    status("loading tokenizer\u2026");
    const tjs = mods.transformers ?? await importOptional(TJS_PKG, () => import("@huggingface/transformers"), "the tokenizer");
    const tk = m.tokenizer;
    const tok = tokenizerFromJson(tjs, await files.json(tk.repo, tk.revision, tk.files.tokenizer), await files.json(tk.repo, tk.revision, tk.files.config));
    assertManifestTokens(tok, m);
    const loadOrt = async () => {
      if (ort) return ort;
      ort = platform === "node" ? await importOptional(NODE_ORT, () => dynImport(NODE_ORT), "ONNX Runtime in Node") : await importOptional("onnxruntime-web", () => import("onnxruntime-web/webgpu"), "ONNX Runtime in the browser");
      return ort;
    };
    const eos = new Set(m.eos.map((t) => t.id));
    const basename = (p) => p.split("/").pop();
    const loaders = {
      genai: async (b, d) => {
        const o = platform === "browser" && d === "wasm" ? mods.ort : await loadOrt();
        let kvHeadDim = b.kvHeadDim;
        if (b.files.genaiConfig) kvHeadDim = (await files.json(b.repo, b.revision, b.files.genaiConfig))?.model?.decoder?.head_size ?? kvHeadDim;
        let embeddings;
        const ef = b.files.embeddings;
        if (ef) {
          status("loading embeddings table\u2026");
          if (ef.size === void 0) throw new Error(`build ${b.repo}: files.embeddings needs a pinned size`);
          if (platform === "node") embeddings = await fileTable(await files.local(b.repo, b.revision, ef), m.hiddenSize);
          else if (ef.size <= SMALL_FILE_LIMIT) embeddings = embeddingTableFromBytes(await files.bytes(b.repo, b.revision, ef), m.hiddenSize);
          else embeddings = httpRangeTable(await files.large(b.repo, b.revision, ef), ef.size, m.hiddenSize, f);
        }
        const gopts = { ...opts.genai, eos, hiddenOutput: b.hiddenOutput, forecastOutput: b.forecastOutput ?? null, kvHeadDim, ort: o, skipVersionCheck: opts.skipVersionCheck, embeddings };
        status(`loading genai graph (${d})\u2026`);
        try {
          if (platform === "browser") {
            const graph = await files.bytes(b.repo, b.revision, b.files.model);
            const dataUrl = await files.large(b.repo, b.revision, b.files.data);
            if (d === "wasm") return await createGenai(graph, dataUrl, basename(b.files.data.path), { ...gopts, ort: mods.ort, providers: ["wasm"], modelKey: b.files.model.sha256 });
            return await createGenai(graph, dataUrl, basename(b.files.data.path), { ...gopts, modelKey: b.files.model.sha256 });
          }
          await files.local(b.repo, b.revision, b.files.data);
          nodeFloat16Workaround(o);
          const S = await o.InferenceSession.create(await files.local(b.repo, b.revision, b.files.model), { executionProviders: [d], graphOptimizationLevel: "all", logSeverityLevel: 3 });
          try {
            return genaiFromSession(S, o, gopts);
          } catch (e) {
            try {
              await S.release?.();
            } catch {
            }
            throw e;
          }
        } catch (e) {
          await embeddings?.close?.();
          throw e;
        }
      },
      "decode-only": async (b, d) => {
        const o = await loadOrt();
        const providers = opts.decodeOnly?.providers ?? [d];
        status(`loading decode-only graph (${providers.join(",")})\u2026`);
        let S;
        if (platform === "node") {
          await files.local(b.repo, b.revision, b.files.data);
          S = await o.InferenceSession.create(await files.local(b.repo, b.revision, b.files.model), { executionProviders: providers, logSeverityLevel: 3 });
        } else {
          const graph = await files.bytes(b.repo, b.revision, b.files.model);
          S = await o.InferenceSession.create(graph, { executionProviders: providers, externalData: [{ path: basename(b.files.data.path), data: await files.large(b.repo, b.revision, b.files.data) }] });
        }
        try {
          return await createDecodeOnly(S, { ort: o, eos, hiddenOutput: b.hiddenOutput, forecastOutput: b.forecastOutput ?? null, pastLen: opts.decodeOnly?.pastLen, skipVersionCheck: platform === "node" || opts.skipVersionCheck });
        } catch (e) {
          try {
            await S.release?.();
          } catch {
          }
          throw e;
        }
      },
      "transformers.js": async (b, d) => {
        status(`loading transformers.js graph (${b.dtype ?? "default dtype"}, ${d})\u2026`);
        const env = tjs.env;
        let modelId = b.repo;
        if (platform === "node") {
          const path = await dynImport("node:path");
          const locals = await Promise.all(Object.values(b.files).map((p) => files.local(b.repo, b.revision, p)));
          const modelPath = locals[Object.keys(b.files).indexOf("model")];
          const root = path.resolve(path.dirname(modelPath), path.relative(path.dirname(b.files.model.path), "."));
          env.allowRemoteModels = false;
          env.allowLocalModels = true;
          env.localModelPath = path.dirname(root) + path.sep;
          modelId = path.basename(root);
        } else {
          for (const p of Object.values(b.files)) {
            if ((p.size ?? Infinity) <= 1e6) await files.bytes(b.repo, b.revision, p);
            else await files.large(b.repo, b.revision, p);
          }
          env.allowRemoteModels = true;
        }
        const model = await tjs.AutoModelForCausalLM.from_pretrained(modelId, { dtype: b.dtype, device: d, revision: platform === "node" ? void 0 : b.revision });
        return transformersJsFromModel(model, tjs.Tensor, { eos, hiddenOutput: b.hiddenOutput, forecastOutput: b.forecastOutput ?? null });
      },
      webllm: async (b) => {
        const webllm = mods.webllm ?? await importOptional(WEBLLM_PKG, () => dynImport(WEBLLM_PKG), 'runtime "webllm"');
        if (!b.modelId) throw new Error(`build ${b.repo}: webllm needs modelId`);
        await files.bytes(b.repo, b.revision, b.files.config);
        let recovery;
        if (b.files.recoveryRows && b.files.recoveryP) {
          status("loading WebLLM hidden-state recovery\u2026");
          const rows = await files.bytes(b.repo, b.revision, b.files.recoveryRows), P = await files.bytes(b.repo, b.revision, b.files.recoveryP);
          const ab = (u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
          recovery = { rows: new Int32Array(ab(rows)), P: b.files.recoveryP.path.endsWith(".f16") ? new Uint16Array(ab(P)) : new Float32Array(ab(P)) };
        }
        const libUrl = b.files.lib ? await files.large(b.repo, b.revision, b.files.lib) : void 0;
        const modelUrl = opts.baseUrls?.[b.repo] ?? `https://huggingface.co/${b.repo}/resolve/${b.revision}/`;
        const appConfig = opts.webllm?.appConfig ?? { model_list: [{ model: modelUrl, model_id: b.modelId, model_lib: libUrl }] };
        status("loading WebLLM build\u2026");
        return createWebllm(webllm, { modelId: b.modelId, modelUrl, libUrl, appConfig, tok, recovery, eos, initProgressCallback: opts.webllm?.initProgressCallback });
      },
      litert: async (b, d) => {
        const lrt = mods.litert ?? await importOptional(LITERT_PKG, () => dynImport(LITERT_PKG), 'runtime "litert"');
        status(`loading LiteRT.js ${LITERTJS_VERSION} runtime\u2026`);
        try {
          await lrt.loadLiteRt(opts.litert?.wasmUrl ?? `https://cdn.jsdelivr.net/npm/@litertjs/core@${LITERTJS_VERSION}/wasm/`, { jspi: !!globalThis.WebAssembly?.Suspending });
        } catch (e) {
          if (!/already loading|already loaded/i.test(String(e?.message ?? e))) throw e;
        }
        const lman = await files.json(b.repo, b.revision, b.files.manifest);
        if (lman.hidden !== m.hiddenSize) throw new Error(`litert bundle hidden ${lman.hidden} != manifest hiddenSize ${m.hiddenSize}`);
        const graph = await files.bytes(b.repo, b.revision, b.files.graph);
        const weightsUrl = await files.large(b.repo, b.revision, b.files.weights);
        const embedUrl = await files.large(b.repo, b.revision, b.files.embed);
        status("streaming LiteRT weights into WebGPU\u2026");
        return createLiteRt(lrt, graph, lman, embedFromF16Reader(httpRangeReader(embedUrl), lman.hidden), {
          eos,
          hiddenOutput: b.hiddenOutput,
          accelerator: d === "webgpu" ? "webgpu" : "wasm",
          gpuPrecision: opts.litert?.precision,
          quiet: opts.litert?.quiet,
          weights: lman.externalized === false ? void 0 : () => {
            let body = null;
            return new ReadableStream({
              async pull(c) {
                body ??= (await f(weightsUrl)).body.getReader();
                const { done, value } = await body.read();
                if (done) c.close();
                else c.enqueue(value);
              },
              cancel() {
                body?.cancel();
              }
            });
          }
        });
      }
    };
    const reasons = [];
    for (const [i, plan] of plans.entries()) {
      if (i > 0) status(`${reasons.at(-1)} -> ${plan.build} (${plan.device})`);
      const b = m.builds[plan.build];
      let backend = null;
      try {
        if (b.attention === "noncausal") throw new Error(`build ${plan.build}: its heads need a non-causal decision pass (attention "noncausal", spec 7); s1s2 0.1 runtimes are causal`);
        backend = await loaders[plan.runtime](b, plan.device);
        const heads = opts.heads === false ? {} : await loadHeads(m, b, files, status);
        const norm = opts.heads === false || !b.norm ? void 0 : await loadBuildNorm(m, b, files);
        const fr = opts.forecast === false ? void 0 : await loadForecast(m, b, files, status);
        await assertBackend(m, b, backend, fr);
        const s = new _S1S2(m, plan, { manifest: m, tok, backend, heads, norm, maxSafeTokens: opts.maxSafeTokens ?? b.maxSafeTokens ?? m.defaults.maxSafeTokens ?? 2048, ...forecastState(m, b, backend, fr, opts.forecast === false) });
        if (plan.device === "wasm" && !webgpu && (opts.device ?? "auto") === "auto") reasons.unshift(`WebGPU is not available (${gpu.reason}): running on the browser CPU (WASM), slower than WebGPU${plan.runtime === "genai" ? " (7.5-16.5x when measured)" : ""}`);
        if (reasons.length) s.fallbackReason = reasons.join("; ");
        s.withBuildLoader((build) => _S1S2.load({ ...opts, manifest: m, build, runtime: void 0 }));
        status(`ready: ${plan.build} (${plan.runtime}, ${plan.device})`);
        return s;
      } catch (e) {
        if (backend) {
          try {
            await backend.dispose();
          } catch {
          }
        }
        if (plans.length === 1 || e?.name === "IntegrityError" || e?.name === "ManifestError") throw e;
        reasons.push(`${plan.build} (${plan.device}) unavailable: ${e?.message ?? String(e)}`);
        if (i === plans.length - 1) {
          const err = new Error(`no build loaded. ${reasons.join("; ")}`);
          err.cause = e;
          throw err;
        }
      }
    }
    throw new Error("no build candidate");
  }
};
function nodeFloat16Workaround(ort) {
  const g = globalThis;
  const F163 = g.Float16Array;
  if (typeof F163 === "undefined") return;
  let t;
  try {
    delete g.Float16Array;
    t = new ort.Tensor("float16", new Uint16Array(1), [1]);
  } finally {
    g.Float16Array = F163;
  }
  if (!(t.data instanceof Uint16Array))
    throw new Error("onnxruntime-node: float16 tensors already use Float16Array in this process (the native binding reads them as empty). Load the model before creating any ort tensor, or run with globalThis.Float16Array removed.");
}
async function loadHeads(m, b, files, status) {
  const out = {};
  const byName = /* @__PURE__ */ new Map();
  for (const t of HEAD_ROLES) {
    const h = headFor(b, t);
    if (!h) continue;
    const seen = byName.get(h.name);
    if (seen) {
      out[t] = seen;
      continue;
    }
    status(`loading head ${h.name}\u2026`);
    const bytes = await files.bytes(b.repo, b.revision, h.spec.file);
    const w = loadAnyHead(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), h.spec);
    const hs = "cfg" in w ? w.cfg.hidden_size : w.hiddenSize;
    if (hs !== m.hiddenSize) throw new Error(`head ${h.spec.file.path}: hiddenSize ${hs} != manifest hiddenSize ${m.hiddenSize}`);
    out[t] = w;
    byName.set(h.name, w);
  }
  return out;
}
async function loadBuildNorm(m, b, files) {
  const bytes = await files.bytes(b.repo, b.revision, b.norm.file);
  const nw = loadNorm(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), b.norm);
  if (nw.hiddenSize !== m.hiddenSize) throw new Error(`norm ${b.norm.file.path}: hiddenSize ${nw.hiddenSize} != manifest hiddenSize ${m.hiddenSize}`);
  return nw;
}
function assertS1Layer(m) {
  if (m.layer.read !== "final") throw new Error(`manifest ${m.id}: layer.read is ${m.layer.read}; this runtime reads the S1 heads on the final hidden state only (the forecast layer is forecast.layer)`);
}
async function loadForecast(m, b, files, status) {
  const f = m.forecast;
  if (!f || b.forecastOutput === void 0) return void 0;
  if (b.forecastLayer !== f.layer) throw new Error(`forecast ${f.id}: the build exposes layer ${b.forecastLayer}, the manifest forecast reads layer ${f.layer}`);
  if (f.trainedOn.baseId !== m.id) throw new Error(`forecast ${f.id}: head trained on "${f.trainedOn.baseId}", this manifest is "${m.id}"`);
  status(`loading forecast head ${f.id}\u2026`);
  const bytes = await files.bytes(f.head.repo ?? b.repo, f.head.revision ?? b.revision, f.head.file);
  return ForecastReader.load(f, bytes, m.hiddenSize);
}
function forecastState(m, b, backend, fr, off = false) {
  if (fr) {
    if (!backend.extraName) return { forecastWhy: `forecast unsupported: build declares forecastOutput but the ${backend.kind} backend does not expose it` };
    return { forecast: fr };
  }
  if (off) return { forecastWhy: "forecast unsupported: the reader was not loaded (load option forecast: false)" };
  if (!m.forecast) return { forecastWhy: "forecast unsupported: the manifest has no forecast section" };
  return { forecastWhy: `forecast unsupported: build ${JSON.stringify(b.repo)} (runtime ${b.runtime}) exposes no forecast layer (no forecastOutput${b.runtime === "webllm" || b.runtime === "litert" ? "; this runtime returns logits only" : ""})` };
}
async function assertBackend(m, b, be, forecast) {
  const tok = m.warmup?.id ?? m.eos[0].id;
  const r = await be.prefill([tok], { positions: be.hiddenName ? [0] : [], ...forecast && be.extraName ? { extra: { positions: [0] } } : {} });
  if (forecast && be.extraName) {
    const x = r.extra?.[0];
    if (!x || x.length !== m.hiddenSize) throw new Error(`build ${b.repo}@${b.revision}: forecast output ${be.extraName} has width ${x?.length}, manifest hiddenSize is ${m.hiddenSize}`);
  }
  if (be.hiddenName) {
    const h = r.hiddens[0];
    if (!h || h.length !== m.hiddenSize) throw new Error(`build ${b.repo}@${b.revision}: hidden output ${be.hiddenName} has width ${h?.length}, manifest hiddenSize is ${m.hiddenSize}`);
  }
  const ids = [m.logits.predicate.yes.id, m.logits.predicate.no.id, ...m.eos.map((t) => t.id), ...(m.logits.score.tokens ?? []).map((t) => t.id), ...taskTokens(m).map((t) => t.id)];
  const mx = Math.max(...ids);
  if (r.lastLogits.length <= mx) throw new Error(`build ${b.repo}@${b.revision}: vocabulary ${r.lastLogits.length} does not cover manifest token ${mx}`);
}
export {
  CLEF_PROMPT,
  DecisionSession,
  FORECAST_BINS,
  FORECAST_POOLINGS,
  Files,
  ForecastReader,
  GENAI_BROWSER_CPU_NOTE,
  GENERATE_DEFAULTS,
  HEAD_KINDS,
  HEAD_ROLES,
  IntegrityError,
  JOINT_QUESTION_TYPES,
  MANIFEST_SCHEMA,
  MARGIN_POLICY_DEFAULTS,
  ManifestError,
  PROVISIONAL_NOTE,
  REQUIRED_ROLES,
  RUNTIMES,
  S1S2,
  appendLead,
  applyNorm,
  assertBackend,
  assertManifestTokens,
  assertWebGpuPlacement,
  autoOrder,
  backOff,
  blockPlan,
  buildMask,
  canShareState,
  choiceFromScores,
  createDecodeOnly,
  createGate,
  createGenai,
  createLiteRt,
  createWebllm,
  decide,
  decisionOf,
  detectCuda,
  detectPlatform,
  detectWebGPU,
  deviceFor,
  embedFromF16Reader,
  embedFromQ8,
  embeddingTable,
  embeddingTableFromBytes,
  encodeJointSchema,
  encodeKev,
  encodeQuestion,
  encodeTagged,
  escapeLiterals,
  escapeSpecial,
  evidenceFromScores,
  f16ToF322 as f16ToF32,
  fileTable,
  fileUrl,
  fill,
  firstTokens,
  forecastPositions,
  forecastProblems,
  forecastScores,
  genaiFromSession,
  generate,
  headFor,
  headScale,
  headScaleSource,
  headScore,
  httpRangeReader,
  httpRangeTable,
  inputToText,
  isJoint,
  isLinear,
  jointOptions,
  jointScores,
  letterLayout,
  linearRaw,
  linearScores,
  loadAnyHead,
  loadForecast,
  loadForecastHead,
  loadHead,
  loadJointHead,
  loadLinearHead,
  loadNorm,
  loadPointerSafetensors,
  logitCapture,
  logitIds,
  manifestPolicy,
  mergePolicy,
  nodeFloat16Workaround,
  normalizeQuestions,
  parsePlacement,
  parseSafetensors,
  planBuilds,
  planEvidence,
  planQuestion,
  poolRows,
  predicateFromP,
  prefillChunks,
  provenanceProblems,
  pyJson,
  questionEntries,
  recoverHidden,
  renderTagged,
  resolveGenerateOptions,
  scoreFromHead,
  scoreFromLogits,
  scoreLayout,
  sha256Hex,
  sharedPrefix,
  shouldEscalate,
  spanLastToken,
  splitSentences,
  taggedEscaper,
  taskTokens,
  thresholdFromQuantile,
  tokenOffsets,
  tokenizerFromJson,
  topGap,
  transformersJsFromModel,
  validateManifest,
  verifyFileOnce,
  webgpuStatus,
  webllmBackend,
  wrapSession,
  wrapTokenizer
};
