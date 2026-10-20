/*
 * 강릉 추천 · 동작 코드 (갈림길 방식)
 * 단계와 보기는 flow.js, 업체 정보는 places.js에 있습니다.
 * 예전 점수 합산 방식 퀴즈는 old 폴더에 보관되어 있습니다.
 */

// ===========================================================================
// 네이버지도 버튼 설정 — 바꿀 일이 있으면 여기만 고치세요.
// ===========================================================================
const MAP_CONFIG = {
  // 네이버지도 앱이 "어느 서비스에서 열었는지" 알아보는 값 (네이버 URL Scheme의 appname).
  // 지금은 임시 값입니다. 페이지를 웹에 올린 뒤에는 배포 주소로 바꿔 주세요.
  //   예) NAVER_APP_NAME: "https://내아이디.github.io/gangneung",
  // 따옴표 안의 글자만 바꾸면 됩니다. 버튼 주소에는 자동으로 인코딩되어 들어가요.
  NAVER_APP_NAME: "https://shinemuscat99.github.io/gangneung-picks/",

  // 지도검색어가 비어 있을 때 업체 이름 앞에 붙이는 말 (기본 검색어 = "강릉 " + 이름)
  QUERY_PREFIX: "강릉 ",

  // 아이폰에서 앱 버튼을 누른 뒤, 이 시간(밀리초) 동안 앱으로 넘어가지 않으면
  // "웹으로 보기" 안내를 띄웁니다. 2000 = 2초
  APP_FALLBACK_MS: 2000
};

// 네이버지도 주소 (네이버 공식 형식)
const NAVER_WEB_SEARCH = "https://map.naver.com/p/search/";
const NAVER_APP_SEARCH = "nmap://search";
const NAVER_ANDROID_PACKAGE = "com.nhn.android.nmap";
// 네이버 플레이스 사진 탭 (플레이스 번호가 있을 때만 사용)
const NAVER_PLACE_PHOTO = (id) => `https://m.place.naver.com/place/${id}/photo`;

// 기기 구분: 휴대폰이면 앱 + 웹 버튼, 컴퓨터면 웹 버튼만
// (컴퓨터에서 휴대폰 화면을 미리 보려면 주소 끝에 ?device=android 또는 ?device=ios 를 붙이세요)
const DEVICE = (() => {
  const forced = new URLSearchParams(location.search).get("device");
  if (forced === "android" || forced === "ios" || forced === "desktop") return forced;
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "android";
  // 최신 아이패드는 자신을 맥(MacIntel)이라고 알려서 터치 지원 여부로 한 번 더 확인
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return "desktop";
})();

const EMPTY_FIELD = "(직접 입력 예정)";
const NO_AREA = "동네 미입력";

// 업체 카드에 보여줄 칸 (memo 는 화면에 보여주지 않음)
const PLACE_FIELDS = { address: "주소", hours: "영업시간", menu: "메뉴", price: "가격" };

// ---------------------------------------------------------------------------
// 화면 요소
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const screens = {
  start: $("screen-start"),
  question: $("screen-question"),
  result: $("screen-result")
};

// 지금까지 고른 답: [{ step: "area", option: {...} }, ...]
let history = [];
let currentStep = null;
let validPlaces = [];

// ---------------------------------------------------------------------------
// flow.js · places.js 불러오기·검사
// ---------------------------------------------------------------------------
const errorLines = [];   // 빨간 안내
const warningLines = []; // 노란 안내
let fatal = false;       // 시작할 수 없는 오류

function syntaxErrorLines(file, what) {
  const err = (window.DATA_FILE_ERRORS || {})[file];
  const where = err && err.line ? `${file}의 <strong>${err.line}번째 줄 또는 바로 윗줄</strong>` : file;
  return [
    `⚠️ ${what}를 읽지 못했어요. ${where}에 문법 오류가 있는 것 같아요.`,
    "쉼표(,), 따옴표(\"), 괄호 { } [ ] 의 짝을 확인한 뒤 저장하고 새로고침(F5) 해 주세요."
  ];
}

function optionValues(stepId) {
  return STEPS[stepId].options.map((o) => o.value);
}

// 출발지 + 출발지는 아니지만 업체 동네로 쓸 수 있는 동네(flow.js의 EXTRA_AREAS)
function allAreas() {
  const extra = typeof EXTRA_AREAS !== "undefined" && Array.isArray(EXTRA_AREAS) ? EXTRA_AREAS : [];
  return [...optionValues("area"), ...extra];
}

function loadFlow() {
  if (typeof STEPS === "undefined" || typeof WANT_ORDER === "undefined") {
    errorLines.push(...syntaxErrorLines("flow.js", "단계 데이터"));
    fatal = true;
  }
}

function loadPlaces() {
  if (typeof PLACES === "undefined") {
    errorLines.push(...syntaxErrorLines("places.js", "업체 데이터"));
    fatal = true;
    return;
  }
  if (!Array.isArray(PLACES)) {
    errorLines.push("⚠️ places.js의 PLACES는 [ ] 로 감싼 목록이어야 해요.");
    fatal = true;
    return;
  }

  const areas = allAreas();
  const categories = optionValues("want");
  const cafeTypes = optionValues("cafeType");
  const cafeCategory = STEPS.want.options.find((o) => o.next === "cafeType")?.value;

  PLACES.forEach((place, i) => {
    const who = `${i + 1}번째 업체 <strong>"${place && place.name ? place.name : "(이름 없음)"}"</strong>`;
    if (!place || typeof place !== "object") {
      errorLines.push(`❌ ${i + 1}번째 업체: { } 로 감싼 업체 정보가 아니에요.`);
      return;
    }

    const problems = [];
    const notes = [];
    const area = text(place.area);
    const placeCategories = categoriesOf(place);
    const cafeType = text(place.cafeType);

    if (!text(place.name)) problems.push("name(이름)이 비어 있어요.");

    if (!area) notes.push(`area(동네)가 비어 있어요. 결과에서는 '${NO_AREA}'으로 다른 동네 쪽에 나와요.`);
    else if (!areas.includes(area)) problems.push(`area(동네) <strong>"${area}"</strong>는 없는 동네 이름이에요. (${areas.join(" / ")})`);

    if (placeCategories.length === 0) problems.push(`category(분류)가 비어 있어요. (${categories.join(" / ")})`);
    placeCategories
      .filter((c) => !categories.includes(c))
      .forEach((c) => problems.push(`category(분류) <strong>"${c}"</strong>는 없는 분류 이름이에요. (${categories.join(" / ")})`));

    if (placeCategories.includes(cafeCategory)) {
      if (!cafeType) notes.push(`cafeType(카페 종류)이 비어 있어서 카페 결과에 나오지 않아요. (${cafeTypes.join(" / ")})`);
      else if (!cafeTypes.includes(cafeType)) problems.push(`cafeType(카페 종류) <strong>"${cafeType}"</strong>는 없는 이름이에요. (${cafeTypes.join(" / ")})`);
    } else if (cafeType && placeCategories.length > 0) {
      notes.push(`카페가 아닌데 cafeType이 적혀 있어요. 이 칸은 무시돼요.`);
    }

    const sharedUrl = text(place["네이버지도링크"]);
    if (sharedUrl && !/^https:\/\//.test(sharedUrl)) {
      notes.push("네이버지도링크는 https:// 로 시작해야 해요. 지금은 링크 대신 검색어로 연결해요.");
    } else if (sharedUrl && !isNaverMapUrl(sharedUrl)) {
      notes.push("네이버지도링크가 네이버지도 공유 링크(naver.me 또는 map.naver.com)가 맞는지 확인해 주세요.");
    }
    if (text(place.mapUrl)) notes.push("mapUrl 칸은 이제 쓰지 않아요. 지도 링크는 네이버지도링크 칸으로 옮겨 주세요.");

    problems.forEach((p) => errorLines.push(`❌ ${who}: ${p}`));
    notes.forEach((n) => warningLines.push(`📝 ${who}: ${n}`));
    if (problems.length === 0) validPlaces.push(place);
  });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// 업체 분류: "산책" 처럼 하나 또는 ["산책", "바다"] 처럼 여러 개
function categoriesOf(place) {
  const raw = Array.isArray(place.category) ? place.category : [place.category];
  return raw.map(text).filter(Boolean);
}

// flow.js의 STEP_TIPS 검사: 없는 동네·상황·보기 이름이면 노란 안내
function loadTips() {
  if (typeof STEP_TIPS === "undefined" || !Array.isArray(STEP_TIPS)) return;
  const areas = optionValues("area");
  const moods = optionValues("mood");
  const wants = optionValues("want");
  STEP_TIPS.forEach((tip, i) => {
    const who = `flow.js 추천 카드 ${i + 1}번 <strong>"${tip && tip.title ? tip.title : ""}"</strong>`;
    const when = (tip && tip.when) || {};
    if (!areas.includes(when.area)) warningLines.push(`📝 ${who}: when.area "${when.area}"는 출발지 이름이 아니에요. (${areas.join(" / ")})`);
    if (!moods.includes(when.mood)) warningLines.push(`📝 ${who}: when.mood "${when.mood}"는 2단계 value가 아니에요. (${moods.join(" / ")})`);
    ((tip && tip.actions) || []).filter((a) => !wants.includes(a))
      .forEach((a) => warningLines.push(`📝 ${who}: actions의 "${a}"는 3단계 value가 아니에요. (${wants.join(" / ")})`));
  });
}

function loadData() {
  loadFlow();
  if (!fatal) {
    loadPlaces();
    loadTips();
  }

  if (errorLines.length > 0) {
    const head = fatal ? [] : ["⚠️ places.js에서 고쳐야 할 곳이 있어요. 아래 업체는 결과에서 빠졌어요."];
    showNotice("data-error", [...head, ...errorLines]);
  }
  // 노란 안내는 한 줄로 접어 두고, 누르면 펼쳐짐
  if (warningLines.length > 0) {
    $("warning-summary").textContent = `📝 나중에 채울 곳 ${warningLines.length}개 (결과에는 나와요) · 눌러서 보기`;
    showNotice("warning-body", warningLines);
    $("data-warning").hidden = false;
  }
  $("data-alerts").hidden = errorLines.length === 0 && warningLines.length === 0;
  if (fatal) $("btn-start").disabled = true;
}

// 안내 문구는 textContent로 넣되, 강조용 <strong>만 허용
function showNotice(id, lines) {
  const box = $(id);
  box.innerHTML = "";
  lines.forEach((line) => {
    const p = document.createElement("p");
    line.split(/<strong>|<\/strong>/).forEach((part, i) => {
      if (i % 2 === 1) {
        const strong = document.createElement("strong");
        strong.textContent = part;
        p.appendChild(strong);
      } else {
        p.appendChild(document.createTextNode(part));
      }
    });
    box.appendChild(p);
  });
  box.hidden = false;
}

// ---------------------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------------------
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("is-active"));
  screens[name].classList.add("is-active");
  window.scrollTo(0, 0);
}

// 시작하기: 기록을 지우고 1단계부터
function restart() {
  history = [];
  currentStep = FIRST_STEP;
  renderStep();
  showScreen("question");
}

function goHome() {
  history = [];
  showScreen("start");
}

// 한 단계 뒤로: 마지막으로 고른 답을 지우고 그 단계를 다시 보여줌
function goBack() {
  if (history.length === 0) {
    goHome();
    return;
  }
  const last = history.pop();
  currentStep = last.step;
  renderStep(last.option.value);
  showScreen("question");
}

function answerOf(step) {
  const found = history.find((h) => h.step === step);
  return found ? found.option : null;
}

// 지금까지 지나온 단계 수 + 남은 단계 수
function stepCount() {
  const want = answerOf("want");
  const goesToCafe = currentStep === "cafeType" || (want && want.next);
  return goesToCafe ? 4 : 3;
}

// ---------------------------------------------------------------------------
// 단계 화면
// ---------------------------------------------------------------------------
function orderedOptions(stepId) {
  const options = STEPS[stepId].options.slice();
  if (stepId !== "want") return options;

  const mood = answerOf("mood");
  const rule = mood && WANT_ORDER[mood.value];
  if (!rule) return options;

  const pick = (values) => (values || []).map((v) => options.find((o) => o.value === v)).filter(Boolean);
  const front = pick(rule.front);
  const back = pick(rule.back);
  const middle = options.filter((o) => !front.includes(o) && !back.includes(o));
  return [...front, ...middle, ...back];
}

function renderStep(selectedValue) {
  const step = STEPS[currentStep];
  const index = history.length;
  const total = stepCount();

  // 화면 모양용 표시: 지금 단계 이름 (카페 종류 단계는 CSS에서 큰 카드·산호색 배지로 보여줌)
  screens.question.dataset.step = currentStep;

  $("progress-text").textContent = `${index + 1} / ${total}`;
  $("progress-fill").style.width = `${(index / total) * 100}%`;
  $("question-title").textContent = step.title;
  renderTip();

  const box = $("options");
  box.innerHTML = "";
  orderedOptions(currentStep).forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option" + (opt.value === selectedValue ? " is-selected" : "");

    if (opt.emoji) {
      const emoji = document.createElement("span");
      emoji.className = "option-emoji";
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = opt.emoji;
      btn.appendChild(emoji);
    }

    const label = document.createElement("span");
    label.className = "option-label";
    label.textContent = opt.label;
    btn.appendChild(label);

    btn.addEventListener("click", () => choose(opt));
    box.appendChild(btn);
  });
}

function choose(option) {
  history.push({ step: currentStep, option });
  const next = option.next || NEXT_STEP[currentStep];
  if (next) {
    currentStep = next;
    renderStep();
    window.scrollTo(0, 0);
  } else {
    showResult();
  }
}

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 3단계 위 추천 카드 (flow.js의 STEP_TIPS, '출발지 + 상황'이 맞을 때만)
// ---------------------------------------------------------------------------
function renderTip() {
  const box = $("step-tip");
  box.innerHTML = "";
  box.hidden = true;
  if (currentStep !== "want" || typeof STEP_TIPS === "undefined" || !Array.isArray(STEP_TIPS)) return;

  const area = answerOf("area");
  const mood = answerOf("mood");
  const tip = STEP_TIPS.find((t) => t && t.when && area && mood &&
    t.when.area === area.value && t.when.mood === mood.value);
  if (!tip) return;

  const eyebrow = document.createElement("p");
  eyebrow.className = "tip-eyebrow";
  eyebrow.textContent = tip.eyebrow || "";
  const title = document.createElement("h3");
  title.className = "tip-title";
  title.textContent = tip.title || "";
  const desc = document.createElement("p");
  desc.className = "tip-text";
  desc.textContent = tip.text || "";

  const actions = document.createElement("div");
  actions.className = "tip-actions";
  (tip.actions || []).forEach((value) => {
    const opt = STEPS.want.options.find((o) => o.value === value);
    if (!opt) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-chip tip-action";
    btn.textContent = `${opt.emoji ? opt.emoji + " " : ""}${withRo(opt.path || opt.label)} 보기`;
    btn.addEventListener("click", () => choose(opt));
    actions.appendChild(btn);
  });

  box.append(eyebrow, title, desc, actions);
  box.hidden = false;
}

// "산책" → "산책으로", "바다" → "바다로" (받침에 따라 조사 고르기)
function withRo(word) {
  const code = word.charCodeAt(word.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const final = (code - 0xac00) % 28;
    return word + (final === 0 || final === 8 ? "로" : "으로");
  }
  return word + "로";
}

function matches(place, category, cafeType) {
  if (!categoriesOf(place).includes(category)) return false;
  return cafeType ? text(place.cafeType) === cafeType : true;
}

function showResult() {
  const area = answerOf("area").value;
  const want = answerOf("want");
  const cafe = answerOf("cafeType");
  const category = want.value;
  const cafeType = cafe ? cafe.value : null;

  // 내가 고른 길
  $("route-path").textContent = history.map((h) => h.option.path || h.option.label).join(" · ");
  $("result-title").textContent = `${area}에서 가 볼 곳`;

  const found = validPlaces.filter((p) => matches(p, category, cafeType));
  const same = found.filter((p) => text(p.area) === area);
  const others = found.filter((p) => text(p.area) !== area);

  // 같은 동네
  $("same-title").textContent = `${area}의 추천 업체 ${same.length}곳`;
  $("same-title").hidden = same.length === 0;
  fillList($("same-list"), same);

  // 안내 문구
  const message = $("result-message");
  if (same.length > 0) {
    message.hidden = true;
  } else if (others.length > 0) {
    message.hidden = false;
    message.textContent = `${area}엔 아직 등록된 곳이 없어요. 다른 동네는 어때요? 👀`;
  } else {
    message.hidden = false;
    message.textContent = "아직 등록된 곳이 없어요 🙂 곧 채워 둘게요! 다른 선택지도 둘러보세요.";
  }

  // 다른 동네 (접어 두기, 같은 동네가 없으면 펼쳐 두기)
  const otherBox = $("other-areas");
  otherBox.hidden = others.length === 0;
  otherBox.open = same.length === 0;
  $("other-summary").textContent = `다른 동네도 볼래? (${others.length}곳)`;
  fillGroups($("other-groups"), others);

  // 아무 데도 없으면: 이 동네에 업체가 있는 다른 선택지 안내
  renderSuggestions(found.length === 0 ? area : null, category, cafeType);

  showScreen("result");
}

function fillList(list, places) {
  list.innerHTML = "";
  places.forEach((p) => list.appendChild(renderPlace(p)));
}

// 다른 동네 업체를 동네별로 묶기 (출발지 순서 → EXTRA_AREAS 순서, 동네 미입력은 맨 뒤)
function fillGroups(container, places) {
  container.innerHTML = "";
  const order = [...allAreas(), NO_AREA];
  order.forEach((areaName) => {
    const group = places.filter((p) => (text(p.area) || NO_AREA) === areaName);
    if (group.length === 0) return;
    const title = document.createElement("h4");
    title.className = "group-title";
    title.textContent = `${areaName} · ${group.length}곳`;
    const list = document.createElement("ol");
    list.className = "place-list";
    fillList(list, group);
    container.append(title, list);
  });
}

// 같은 동네에서 업체가 등록된 다른 분류(카페는 카페 종류까지)를 버튼으로 보여줌
function renderSuggestions(area, category, cafeType) {
  const box = $("suggestions");
  const list = $("suggestion-list");
  list.innerHTML = "";
  if (!area) {
    box.hidden = true;
    return;
  }

  const seen = new Set();
  validPlaces
    .filter((p) => text(p.area) === area)
    .forEach((p) => categoriesOf(p).forEach((placeCategory) => {
      const want = STEPS.want.options.find((o) => o.value === placeCategory);
      if (!want) return;
      const cafe = want.next ? STEPS.cafeType.options.find((o) => o.value === text(p.cafeType)) : null;
      if (want.next && !cafe) return;
      if (want.value === category && (!cafe || cafe.value === cafeType)) return;
      const key = want.value + "|" + (cafe ? cafe.value : "");
      if (seen.has(key)) return;
      seen.add(key);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-chip";
      btn.textContent = `${want.emoji ? want.emoji + " " : ""}${want.path || want.label}${cafe ? " · " + cafe.label : ""} 보기`;
      btn.addEventListener("click", () => jumpTo(want, cafe));
      list.appendChild(btn);
    }));

  box.hidden = false;
  $("suggestion-title").textContent = list.children.length > 0
    ? `${area}에는 이런 곳이 있어요`
    : "이전으로 돌아가 다른 걸 골라 볼까요?";
}

// 제안 버튼: 3·4단계 답만 바꿔서 바로 결과로
function jumpTo(want, cafe) {
  history = history.filter((h) => h.step === "area" || h.step === "mood");
  history.push({ step: "want", option: want });
  if (cafe) history.push({ step: "cafeType", option: cafe });
  showResult();
}

function renderPlace(place) {
  const li = document.createElement("li");
  li.className = "place-card";

  const area = text(place.area);
  const cafeLabel = STEPS.cafeType.options.find((o) => o.value === text(place.cafeType));
  const placeCategories = categoriesOf(place);
  const isCafe = STEPS.want.options.some((o) => o.next && placeCategories.includes(o.value));
  const categoryText = placeCategories
    .map((c) => (STEPS.want.options.find((o) => o.value === c) || {}).path || c)
    .join(" · ");

  // 위 메타 줄: 왼쪽 번호(01, 02 … style.css가 자동으로 붙임), 오른쪽 분류
  const meta = document.createElement("div");
  meta.className = "place-meta";
  const metaCategory = document.createElement("span");
  metaCategory.className = "place-meta-category";
  metaCategory.textContent = categoryText;
  meta.appendChild(metaCategory);
  li.appendChild(meta);

  // [사진 자리 ②] 사진(places.js의 사진 칸) 또는 풍경 그림 + 동네 배지
  li.appendChild(renderPlaceMedia(placeCategories, area, text(place["사진"]), text(place.name)));

  const body = document.createElement("div");
  body.className = "place-body";
  li.appendChild(body);

  // 카페면 카페 종류를 작은 청록 줄로
  if (isCafe && cafeLabel) {
    const kind = document.createElement("p");
    kind.className = "place-kind";
    kind.textContent = cafeLabel.label;
    body.appendChild(kind);
  }

  const name = document.createElement("h4");
  name.className = "place-name";
  name.textContent = text(place.name);
  body.appendChild(name);

  // 정보: 채운 칸은 그대로 보여 주고, 빈 칸은 한 줄로 모아 "(직접 입력 예정)"
  const missing = [];

  const intro = text(place.intro);
  if (intro) {
    const desc = document.createElement("p");
    desc.className = "place-desc";
    desc.textContent = intro;
    body.appendChild(desc);
  } else {
    missing.push("한 줄 소개");
  }

  const fields = document.createElement("dl");
  fields.className = "place-fields";
  Object.entries(PLACE_FIELDS).forEach(([key, label]) => {
    const value = text(place[key]);
    if (value) addField(fields, label, value);
    else missing.push(label);
  });
  if (fields.children.length > 0) body.appendChild(fields);

  if (missing.length > 0) {
    const note = document.createElement("p");
    note.className = "place-missing";
    note.textContent = `${missing.join(" · ")} ${EMPTY_FIELD}`;
    body.appendChild(note);
  }

  // 네이버지도 버튼
  body.appendChild(renderMapButtons(place));

  return li;
}

// 카드 위 그림 영역.
//   places.js의 사진 칸이 있으면 그 사진을, 없거나 파일을 못 찾으면 풍경 그림 + 분류 이모지를 보여줌.
//   풍경 그림 색은 첫 번째 분류의 순서(3단계 보기 순서)에 따라 세 가지 중 하나 (style.css의 data-tone)
function renderPlaceMedia(placeCategories, area, photo, name) {
  const media = document.createElement("div");
  media.className = "place-media photo-slot";

  const firstWant = STEPS.want.options.find((o) => o.value === placeCategories[0]);
  const index = Math.max(0, STEPS.want.options.indexOf(firstWant));
  media.dataset.tone = String(index % 3);

  const emoji = document.createElement("span");
  emoji.className = "place-media-emoji";
  emoji.setAttribute("aria-hidden", "true");
  emoji.textContent = firstWant && firstWant.emoji ? firstWant.emoji : "📍";

  const areaBadge = document.createElement("span");
  areaBadge.className = "media-badge";
  areaBadge.textContent = `📍 ${area || `동네 ${EMPTY_FIELD}`}`;

  if (photo) {
    const img = document.createElement("img");
    img.className = "place-photo";
    img.src = photo;
    img.alt = `${name} 사진`;
    img.loading = "lazy";
    media.classList.add("has-photo");
    emoji.hidden = true;
    // 파일을 못 찾으면 사진을 빼고 풍경 그림으로 되돌림
    img.addEventListener("error", () => {
      img.remove();
      media.classList.remove("has-photo");
      emoji.hidden = false;
    });
    media.appendChild(img);
  } else {
    media.setAttribute("aria-hidden", "true");
  }

  media.append(emoji, areaBadge);
  return media;
}

function addField(dl, label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

// ---------------------------------------------------------------------------
// 네이버지도 링크
// ---------------------------------------------------------------------------
function isNaverMapUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "naver.me" || host === "map.naver.com" || host.endsWith(".map.naver.com");
  } catch {
    return false;
  }
}

// 검색어: 지도검색어 → "강릉 " + 이름
function mapQuery(place) {
  return text(place["지도검색어"]) || MAP_CONFIG.QUERY_PREFIX + text(place.name);
}

// 웹: 네이버지도링크(https://) → 검색어로 만든 검색 주소
function naverWebUrl(place) {
  const shared = text(place["네이버지도링크"]);
  if (/^https:\/\//.test(shared)) return shared;
  return NAVER_WEB_SEARCH + encodeURIComponent(mapQuery(place));
}

// 앱: nmap://search?query=검색어&appname=설정값
function naverAppQuery(place) {
  return `query=${encodeURIComponent(mapQuery(place))}&appname=${encodeURIComponent(MAP_CONFIG.NAVER_APP_NAME)}`;
}

function naverAppUrl(place) {
  return `${NAVER_APP_SEARCH}?${naverAppQuery(place)}`;
}

// 플레이스 사진 보기: 사진을 가져오지 않고 네이버 플레이스로 '연결'만 함 (저작권 문제 없음)
//   1) 네이버지도링크에 플레이스 번호가 들어 있으면 (예: map.naver.com/p/entry/place/12345678)
//      → 그 가게의 사진 탭으로 바로
//   2) 공유 링크(naver.me/…)만 있으면 → 그 링크 (가게 화면에서 '사진' 탭을 누르면 됨)
//   3) 둘 다 없으면 → 웹 검색 결과
function naverPhotoUrl(place) {
  const shared = text(place["네이버지도링크"]);
  const id = (shared.match(/\/place\/(\d+)/) || [])[1];
  if (id) return NAVER_PLACE_PHOTO(id);
  return naverWebUrl(place);
}

// 화면 확인용 (샘플) 업체는 실제 가게가 아니라서 사진 보기 버튼을 빼요
function isSamplePlace(place) {
  return text(place.name).startsWith("(샘플)");
}

// 안드로이드: intent 주소. 앱이 없으면 크롬이 browser_fallback_url(웹 주소)로 자동 이동
function naverAndroidIntentUrl(place) {
  return `intent://search?${naverAppQuery(place)}#Intent;scheme=nmap;action=android.intent.action.VIEW;` +
    `category=android.intent.category.BROWSABLE;package=${NAVER_ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(naverWebUrl(place))};end`;
}

function mapLink(className, label, href, ariaLabel) {
  const a = document.createElement("a");
  a.className = `btn-map ${className}`;
  a.href = href;
  a.textContent = label;
  a.setAttribute("aria-label", ariaLabel);
  return a;
}

function renderMapButtons(place) {
  const box = document.createElement("div");
  box.className = "map-actions";

  const buttons = document.createElement("div");
  buttons.className = "map-buttons";

  // 웹으로 보기: 모든 기기, 새 탭
  const web = mapLink("btn-map-web", "웹으로 보기 ↗", naverWebUrl(place), `${text(place.name)} 네이버지도 웹으로 보기 (새 탭)`);
  web.target = "_blank";
  web.rel = "noopener noreferrer";

  // 앱으로 보기: 휴대폰에서만
  const hint = document.createElement("p");
  hint.className = "map-hint";
  hint.hidden = true;
  hint.textContent = "앱이 안 열리면 위의 '웹으로 보기'를 눌러 주세요.";

  if (DEVICE === "android") {
    const app = mapLink("btn-map-app", "📍 네이버지도 앱으로 보기", naverAndroidIntentUrl(place), `${text(place.name)} 네이버지도 앱으로 보기`);
    app.target = "_blank";
    app.rel = "noopener noreferrer";
    buttons.appendChild(app);
  } else if (DEVICE === "ios") {
    const app = mapLink("btn-map-app", "📍 네이버지도 앱으로 보기", naverAppUrl(place), `${text(place.name)} 네이버지도 앱으로 보기`);
    app.addEventListener("click", (e) => {
      e.preventDefault();
      openIosApp(app.href, hint, web);
    });
    buttons.appendChild(app);
  }

  buttons.appendChild(web);

  // 네이버 플레이스 사진 보기: 모든 기기, 새 탭
  if (!isSamplePlace(place)) {
    const photo = mapLink("btn-map-photo", "📷 네이버 플레이스 사진 보기 ↗", naverPhotoUrl(place),
      `${text(place.name)} 네이버 플레이스 사진 보기 (새 탭)`);
    photo.target = "_blank";
    photo.rel = "noopener noreferrer";
    buttons.appendChild(photo);
  }

  box.appendChild(buttons);
  if (DEVICE === "ios") box.appendChild(hint);
  return box;
}

// 아이폰: 앱을 열어 보고, 잠시 뒤에도 이 페이지가 그대로 보이면 웹 버튼 안내
function openIosApp(url, hint, webButton) {
  let left = false;
  const markLeft = () => { left = true; };
  document.addEventListener("visibilitychange", markLeft, { once: true });
  window.addEventListener("pagehide", markLeft, { once: true });
  // (blur 는 쓰지 않음: 사파리의 '주소가 유효하지 않음' 창만 떠도 blur 가 생길 수 있어서)

  window.location.href = url;

  setTimeout(() => {
    document.removeEventListener("visibilitychange", markLeft);
    window.removeEventListener("pagehide", markLeft);
    if (!left && document.visibilityState === "visible") {
      hint.hidden = false;
      webButton.classList.add("is-suggested");
    }
  }, MAP_CONFIG.APP_FALLBACK_MS);
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------
$("btn-start").addEventListener("click", restart);
$("btn-back").addEventListener("click", goBack);
// 처음부터 다시: 어느 단계에서 누르든 맨 첫 시작 화면으로 (1단계에서 눌러도 반응이 보이도록)
$("btn-restart").addEventListener("click", goHome);
$("btn-result-back").addEventListener("click", goBack);
$("btn-result-restart").addEventListener("click", goHome);

loadData();
