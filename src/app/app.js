/* 무던한 지도 — 화면 동작. 데이터는 data.js(window.CALM): 센서별 요일×시각 168칸
   p: 깜짝 소리 확률(‰, 모델 예측) / a: 지난주 평균 소음(0.1dB) / n: 지난 8주 같은 요일·시각 깜짝 소리 횟수 / w: 관측 주 수 */
(function () {
  const S = window.CALM.sensors;
  const EV = window.CALM.eval;
  const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
  const ORDER = [5, 6, 0, 1, 2, 3, 4];
  const OUT_FROM = 9, OUT_TO = 19;          // 아이와 나서는 시간대(9시~19시 시작)
  const $ = (s) => document.querySelector(s);

  const store = {
    get(k, d) { try { const v = localStorage.getItem("calm." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("calm." + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 화면은 돈다 */ } },
  };
  const st = {
    w: store.get("w", { spike: 1, loud: 0, sens: 0 }),
    day: 5, zone: "전체", q: "", cur: null, pick: null,
    log: store.get("log", []), pin: store.get("pin", null),
  };

  // 한 시간의 부담 점수(0~1): 깜짝 소리 확률과 계속되는 소음을 아이 프로필 무게로 섞는다
  function load(s, dow, h) {
    const i = dow * 24 + h;
    if (s.p[i] < 0 || s.w[i] === 0) return null;          // 측정 없는 시간은 추천하지 않는다
    const p = s.p[i] / 1000;
    const a = s.a[i] < 0 ? 0 : s.a[i] / 10;
    const spike = Math.min(1, p / 0.15);
    const loud = Math.max(0, Math.min(1, (a - 50) / 15));
    const ws = st.w.spike, wl = st.w.loud;
    const base = (ws * spike + wl * loud) / Math.max(0.0001, ws + wl);
    return Math.min(1, base * (1 + st.w.sens));
  }
  const cls = (v) => (v === null ? -1 : v < 0.15 ? 0 : v < 0.35 ? 1 : v < 0.6 ? 2 : 3);
  const pair = (s, dow, h) => {
    const a = load(s, dow, h), b = load(s, dow, h + 1);
    return a === null || b === null ? null : (a + b) / 2;
  };
  function best(s, dow) {
    let bi = -1, bv = 9;
    for (let h = OUT_FROM; h < OUT_TO; h++) {
      const v = pair(s, dow, h);
      if (v !== null && v < bv) { bv = v; bi = h; }
    }
    return bi < 0 ? { h: -1, v: 1 } : { h: bi, v: bv };
  }
  function gain(s, dow) {
    let lo = 9, hi = -1;
    for (let h = OUT_FROM; h < OUT_TO; h++) {
      const v = pair(s, dow, h);
      if (v === null) continue;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return hi < 0 ? -1 : hi - lo;
  }
  const hm = (h) => `${h}시`;
  const short = (addr) => addr.split(" ").slice(0, 3).join(" ");

  // 유형 칩
  const zones = ["전체", "공원", "도로·공원", "전통시장", "주요 거리", "상업지역", "주거지역", "공공시설"];
  $("#chips").innerHTML = zones.map((z) => `<button class="chip" aria-pressed="${z === st.zone}" data-z="${z}">${z}</button>`).join("");
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    st.zone = b.dataset.z;
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.z === st.zone));
    render();
  });

  function filtered() {
    const q = st.q.trim();
    return S.filter((s) => (st.zone === "전체" || s.zone === st.zone) && (!q || s.addr.includes(q) || s.gu.includes(q)));
  }

  function card(s) {
    const b = best(s, st.day);
    const bars = [];
    for (let h = 7; h <= 20; h++) {
      const v = load(s, st.day, h);
      if (v === null) { bars.push(`<i class="na" title="${hm(h)} 측정 없음"></i>`); continue; }
      const c = cls(v);
      const win = h === b.h || h === b.h + 1;
      bars.push(`<i class="r${Math.max(1, c)}${win ? " win" : ""}" style="height:${Math.max(6, Math.round(v * 60))}px" title="${hm(h)}"></i>`);
    }
    return `<li class="card" data-id="${s.id}" tabindex="0">
      <div class="strip" aria-hidden="true">${bars.join("")}</div>
      <div class="t"><span>${short(s.addr)}</span><span>${s.zone}</span></div>
      <div class="s">${s.gu} · 7시~20시 깜짝 소리 막대</div>
      <div class="w">${b.h < 0 ? "이날 낮 측정이 모자라요" : `가장 무던한 때 <b>${DAYS[st.day]} ${hm(b.h)}~${hm(b.h + 2)}</b>`}</div></li>`;
  }

  function render() {
    // 시간을 고를 이유가 있는 곳부터: 낮 동안 가장 시끄러운 2시간과 가장 무던한 2시간의 차이가 큰 순
    const list = filtered().map((s) => ({ s, b: best(s, st.day), g: gain(s, st.day) })).filter((x) => x.b.h >= 0)
      .sort((x, y) => y.g - x.g);
    $("#resultTitle").textContent = st.q ? `「${st.q}」 근처, 시간만 잘 고르면 무던한 곳` : `${DAYS[st.day]}요일, 시간만 잘 고르면 무던한 곳`;
    $("#resultMeta").textContent = `센서 ${list.length.toLocaleString()}곳`;
    $("#cards").innerHTML = list.slice(0, 30).map((x) => card(x.s)).join("") || `<li class="muted">찾는 곳 근처에 센서가 없습니다. 동 이름이나 도로명으로 다시 찾아보세요.</li>`;
    drawMap(list.map((x) => x.s));
    $("#profileSummary").textContent = profileText();
    $("#logCount").textContent = st.log.length;
  }

  // 지도: 바탕 타일 없이 센서 위치를 점으로 찍고 자치구 이름을 센서 무게중심에 둔다
  const box = (() => {
    let a = 90, b = -90, c = 180, d = -180;
    S.forEach((s) => { a = Math.min(a, s.lat); b = Math.max(b, s.lat); c = Math.min(c, s.lon); d = Math.max(d, s.lon); });
    return { la0: a, la1: b, lo0: c, lo1: d };
  })();
  function proj(s, W, H) {
    const k = Math.cos((37.55 * Math.PI) / 180);
    const sx = (W - 40) / ((box.lo1 - box.lo0) * k), sy = (H - 40) / (box.la1 - box.la0);
    const sc = Math.min(sx, sy);
    const ox = (W - (box.lo1 - box.lo0) * k * sc) / 2, oy = (H - (box.la1 - box.la0) * sc) / 2;
    return [ox + (s.lon - box.lo0) * k * sc, oy + (box.la1 - s.lat) * sc];
  }
  function drawMap(list) {
    const svg = $("#map");
    const W = svg.clientWidth || 600, H = svg.clientHeight || 600;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const show = new Set(list.map((s) => s.id));
    const col = ["var(--border-strong)", "var(--heat1)", "var(--heat2)", "var(--heat3)"];
    const gus = {};
    let dots = "";
    S.forEach((s) => {
      const [x, y] = proj(s, W, H);
      (gus[s.gu] = gus[s.gu] || []).push([x, y]);
      if (!show.has(s.id)) return;
      const c = Math.max(0, cls(best(s, st.day).v));
      dots += `<circle class="dot" data-id="${s.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${c === 0 ? 3.5 : 4.5}" fill="${col[c]}"><title>${s.addr}</title></circle>`;
    });
    let labels = "";
    Object.entries(gus).forEach(([g, pts]) => {
      if (pts.length < 8) return;
      const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      labels += `<text class="gu" x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle">${g}</text>`;
    });
    svg.innerHTML = dots + labels;
  }
  $("#map").addEventListener("click", (e) => { const d = e.target.closest(".dot"); if (d) open(d.dataset.id); });
  $("#cards").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) open(c.dataset.id); });
  $("#cards").addEventListener("keydown", (e) => { if (e.key === "Enter") { const c = e.target.closest(".card"); if (c) open(c.dataset.id); } });

  // 상세
  function km(a, b) {
    const R = 6371, dLa = ((b.lat - a.lat) * Math.PI) / 180, dLo = ((b.lon - a.lon) * Math.PI) / 180;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function open(id) {
    const s = S.find((x) => x.id === id); if (!s) return;
    st.cur = s;
    const b = best(s, st.day);
    st.pick = { dow: st.day, h: b.h < 0 ? 10 : b.h };
    $("#home").hidden = true; $("#detail").hidden = false; window.scrollTo(0, 0);
    $("#dTitle").textContent = s.addr;
    $("#dMeta").textContent = `${s.gu} · ${s.zone} · S-DoT 센서 ${s.id}`;
    drawWeek(); drawNear(); drawBasis(); drawBest();
    $("#afterResult").textContent = "";
  }
  function drawBest() {
    const s = st.cur, p = st.pick;
    const v = pair(s, p.dow, p.h) ?? 0;
    $("#bestText").textContent = `${DAYS[p.dow]} ${hm(p.h)}~${hm(p.h + 2)}`;
    const pp = [s.p[p.dow * 24 + p.h], s.p[p.dow * 24 + p.h + 1]].filter((x) => x >= 0);
    const pr = pp.length ? (pp.reduce((a, b) => a + b, 0) / pp.length / 10).toFixed(1) + "%" : "측정 없음";
    $("#bestSub").textContent = pair(s, p.dow, p.h) === null ? " · 이 시간은 측정이 없어요" : ` · 깜짝 소리 가능성 ${pr} · 부담 ${Math.round(v * 100)}점`;
  }
  function drawWeek() {
    const s = st.cur;
    let html = `<span></span>` + Array.from({ length: 24 }, (_, h) => `<span class="h">${h}</span>`).join("");
    ORDER.forEach((dow) => {
      const bw = best(s, dow);
      html += `<span class="d">${DAYS[dow]}</span>`;
      for (let h = 0; h < 24; h++) {
        const c = cls(load(s, dow, h));
        const win = bw.h >= 0 && (h === bw.h || h === bw.h + 1);
        const picked = st.pick && st.pick.dow === dow && (h === st.pick.h || h === st.pick.h + 1);
        html += `<button class="cell ${c < 0 ? "na" : "c" + c}${c === 3 ? " x" : ""}${win ? " win" : ""}${picked ? " today" : ""}" data-dow="${dow}" data-h="${h}" aria-label="${DAYS[dow]} ${h}시 ${c < 0 ? "측정 없음" : "부담 " + ["낮음", "조금", "보통", "높음"][c]}"></button>`;
      }
    });
    $("#week").innerHTML = html;
  }
  $("#week").addEventListener("click", (e) => {
    const c = e.target.closest(".cell"); if (!c) return;
    st.pick = { dow: +c.dataset.dow, h: Math.min(22, +c.dataset.h) };
    drawWeek(); drawBest(); drawNear(); drawBasis();
  });
  function drawNear() {
    const s = st.cur, p = st.pick;
    const near = S.filter((x) => x.id !== s.id).map((x) => ({ x, d: km(s, x) })).sort((a, b) => a.d - b.d).slice(0, 3);
    $("#near").innerHTML = near.map(({ x, d }) => {
      const v = pair(x, p.dow, p.h);
      const b = best(x, p.dow);
      return `<li data-id="${x.id}"><strong>${short(x.addr)}</strong><span class="muted">${x.zone} · ${d < 1 ? Math.round(d * 1000) + "m" : d.toFixed(1) + "km"}</span>
        <div class="bar2"><i style="width:${Math.round((v ?? 0) * 100)}%"></i></div>
        <span>${v === null ? "같은 시간 측정 없음" : `같은 시간 부담 ${Math.round(v * 100)}점`} · ${b.h < 0 ? "낮 측정 부족" : `이곳 무던한 때 ${hm(b.h)}~${hm(b.h + 2)}`}</span></li>`;
    }).join("");
  }
  $("#near").addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) open(li.dataset.id); });
  function drawBasis() {
    const s = st.cur, p = st.pick, i = p.dow * 24 + p.h;
    const rows = [
      ["예측 모델", `그래디언트 부스팅 분류기 · 서울 S-DoT ${S.length.toLocaleString()}곳 ${window.CALM.trained} 실측으로 학습`],
      ["시험 주 성적(10월 5~11일)", `깜짝 소리 구분력 AUC ${EV.auc_model} · 지난주 그대로 ${EV.auc_lastweek} · 같은 시각 평균 ${EV.auc_hourmean}`],
      ["추천 2시간의 실제 깜짝 소리", `모델이 고른 낮 2시간 ${(EV.calm_hit_model * 100).toFixed(1)}% · 아무 때나 고르면 ${(EV.calm_hit_random * 100).toFixed(1)}%`],
      [`${DAYS[p.dow]} ${hm(p.h)} 지난 기록`, `지난 ${s.w[i]}주 중 ${s.n[i]}번 깜짝 소리(최대−평균 ≥ 10dB)`],
      [`${DAYS[p.dow]} ${hm(p.h)} 계속되는 소음`, s.a[i] < 0 ? "지난주 측정 없음" : `지난주 평균 ${(s.a[i] / 10).toFixed(1)}dB`],
      ["지금 쓰는 무게", weightText()],
    ];
    $("#basisList").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }

  // 일정 담기 · 다녀온 뒤
  $("#pin").addEventListener("click", () => {
    st.pin = { id: st.cur.id, addr: short(st.cur.addr), dow: st.pick.dow, h: st.pick.h };
    store.set("pin", st.pin);
    $("#pin").textContent = "담았어요";
    setTimeout(() => ($("#pin").textContent = "이 시간 일정에 담기"), 1400);
  });
  document.querySelectorAll("[data-fb]").forEach((b) => b.addEventListener("click", () => {
    const pin = st.pin && st.pin.id === st.cur.id ? st.pin : { id: st.cur.id, addr: short(st.cur.addr), dow: st.pick.dow, h: st.pick.h };
    const s = st.cur, i = pin.dow * 24 + pin.h;
    const spike = Math.min(1, (s.p[i] < 0 ? 0 : s.p[i] / 1000) / 0.15);
    const loud = Math.max(0, Math.min(1, ((s.a[i] < 0 ? 0 : s.a[i] / 10) - 50) / 15));
    const before = weightText();
    if (b.dataset.fb === "hard") {
      if (loud > spike) st.w.loud = Math.min(2, st.w.loud + 0.5); else st.w.spike = Math.min(2, st.w.spike + 0.25);
      st.w.sens = Math.min(0.6, st.w.sens + 0.1);
    } else {
      st.w.sens = Math.max(-0.3, st.w.sens - 0.05);
    }
    store.set("w", st.w);
    st.log.unshift({ addr: pin.addr, when: `${DAYS[pin.dow]} ${hm(pin.h)}`, fb: b.dataset.fb === "hard" ? "힘들었어요" : "괜찮았어요" });
    st.log = st.log.slice(0, 30); store.set("log", st.log);
    $("#afterResult").textContent = `기록했어요. ${before} → ${weightText()}. 시간표와 목록 순서에 바로 반영됩니다.`;
    drawWeek(); drawBest(); drawNear(); drawBasis(); render();
  }));
  function weightText() {
    const s = st.w;
    return `깜짝 소리 ${s.spike.toFixed(2)} · 계속되는 소음 ${s.loud.toFixed(2)} · 민감도 ${s.sens >= 0 ? "+" : ""}${Math.round(s.sens * 100)}%`;
  }

  // 아이 프로필
  function profileText() {
    const a = [];
    if (st.w.spike > 0) a.push("갑작스러운 소리");
    if (st.w.loud > 0) a.push("계속되는 소음");
    return a.join(" · ") || "고르지 않음";
  }
  $("#openProfile").addEventListener("click", () => {
    $("#pSpike").checked = st.w.spike > 0; $("#pLoud").checked = st.w.loud > 0;
    $("#profile").showModal();
  });
  $("#pSave").addEventListener("click", () => {
    const t = $("#pText").value;
    let sp = $("#pSpike").checked, ld = $("#pLoud").checked;
    if (/오토바이|사이렌|경적|공사|확성기|갑자기|큰 소리|폭죽|클랙슨/.test(t)) sp = true;
    if (/차 소리|시장|북적|계속|웅성|사람 많|시끄러운 곳/.test(t)) ld = true;
    if (!sp && !ld) sp = true;
    st.w.spike = sp ? Math.max(1, st.w.spike) : 0;
    st.w.loud = ld ? Math.max(1, st.w.loud) : 0;
    store.set("w", st.w);
    render();
    if (!$("#detail").hidden) { drawWeek(); drawBest(); drawNear(); drawBasis(); }
  });
  $("#openLog").addEventListener("click", () => {
    $("#logList").innerHTML = st.log.map((l) => `<li>${l.addr} · ${l.when} — ${l.fb}</li>`).join("") || "<li class='muted'>아직 기록이 없습니다.</li>";
    $("#weightsNow").textContent = "지금 쓰는 무게: " + weightText();
    $("#log").showModal();
  });

  // 검색·요일·뒤로
  $("#search").addEventListener("submit", (e) => { e.preventDefault(); st.q = $("#q").value; goHome(); });
  $("#day").addEventListener("change", (e) => { st.day = +e.target.value; render(); if (!$("#detail").hidden) open(st.cur.id); });
  function goHome() { $("#detail").hidden = true; $("#home").hidden = false; render(); }
  document.querySelectorAll("[data-go=home]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); goHome(); }));
  window.addEventListener("resize", () => { if (!$("#home").hidden) drawMap(filtered()); });

  render();
})();
