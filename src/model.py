"""무던한 지도 — 다음 주 시간대별 「깜짝 소리」(최대−평균 ≥ 10dB)와 계속되는 소음을 예측하고 검증한다.

학습: 주 k 의 값을 그 앞 주들만으로 만든 특징으로 맞힌다(시간 순서 지킴). 마지막 주(10-05~10-11)는 시험용으로 떼어 둔다.
특징: 요일·시각, 장소 유형, 센서별 같은 요일·시각의 지난 값(1·2주 전), 지난 주들의 평균, 센서 전체 깜짝 소리 비율.
기준선: ① 지난주 같은 시각 그대로 ② 지난 주들의 같은 요일·시각 평균.
실행: python projects/calm_map_2026/model.py
산출: 03_데이터/out/eval.json, forecast.parquet(다음 주 2026-10-12~18 대신 시연 주로 쓰는 주의 예측), model.pkl
"""
from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, roc_auc_score

root = Path(__file__).resolve().parents[2]
out = root / "workspace/contest_auto_clean/workspace/1023_2026_AI_라이프_솔루션_챌린지(0930~1031)/03_데이터/out"
SPIKE = 10.0
ZONES = ["주거지역", "도로·공원", "전통시장", "공업지역", "상업지역", "주요 거리", "공원", "공공시설"]


def table() -> pd.DataFrame:
    d = pd.read_parquet(out / "sdot_hourly.parquet")
    d["week"] = ((d["time"] - pd.Timestamp("2026-08-17")).dt.days // 7).astype(int)
    d["dow"] = d["time"].dt.weekday
    d["hour"] = d["time"].dt.hour
    d["how"] = d["dow"] * 24 + d["hour"]
    d["event"] = (d["spike"] >= SPIKE).astype(int)
    return d[["serial", "zone", "week", "dow", "hour", "how", "navg", "spike", "event"]]


def features(d: pd.DataFrame, k: int) -> pd.DataFrame:
    """주 k 의 행마다 k 보다 앞선 주만 써서 특징을 만든다."""
    past = d[d.week < k]
    cur = d[d.week == k][["serial", "zone", "dow", "hour", "how", "navg", "spike", "event"]].copy()
    lag1 = past[past.week == k - 1].set_index(["serial", "how"])[["navg", "spike"]].add_suffix("_l1")
    lag2 = past[past.week == k - 2].set_index(["serial", "how"])[["navg", "spike"]].add_suffix("_l2")
    how = past.groupby(["serial", "how"]).agg(navg_m=("navg", "mean"), spike_m=("spike", "mean"),
                                              ev_m=("event", "mean"))
    hr = past.groupby(["serial", "hour"]).agg(spike_hm=("spike", "mean"), ev_hm=("event", "mean"))
    sen = past.groupby("serial").agg(ev_s=("event", "mean"), spike_s=("spike", "mean"), navg_s=("navg", "mean"))
    f = cur.join(lag1, on=["serial", "how"]).join(lag2, on=["serial", "how"]).join(how, on=["serial", "how"])
    f = f.join(hr, on=["serial", "hour"]).join(sen, on="serial")
    f["zone_i"] = f["zone"].map({z: i for i, z in enumerate(ZONES)}).fillna(len(ZONES))
    f["week"] = k
    return f


X_COLS = ["dow", "hour", "zone_i", "navg_l1", "spike_l1", "navg_l2", "spike_l2", "navg_m", "spike_m", "ev_m",
          "spike_hm", "ev_hm", "ev_s", "spike_s", "navg_s"]


def calm_window_check(f: pd.DataFrame, score: str) -> float:
    """센서·날마다 낮(9~19시)에서 예측이 가장 조용하다고 본 연속 2시간을 고르고, 실제로 그 2시간에 깜짝 소리가 있었던 비율."""
    g = f[(f.hour >= 9) & (f.hour <= 18)].sort_values(["serial", "dow", "hour"])
    hits, n = 0, 0
    for _, x in g.groupby(["serial", "dow"]):
        if len(x) < 10:
            continue
        s = x[score].to_numpy()
        e = x["event"].to_numpy()
        w = s[:-1] + s[1:]
        i = int(np.argmin(w))
        hits += int(e[i] or e[i + 1])
        n += 1
    return hits / n


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    d = table()
    weeks = sorted(d.week.unique())
    test_k = weeks[-1]
    train = pd.concat([features(d, k) for k in weeks[2:-1]], ignore_index=True)
    test = features(d, test_k)
    clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=31, random_state=0)
    clf.fit(train[X_COLS], train["event"])
    reg = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.06, max_leaf_nodes=31, random_state=0)
    reg.fit(train[X_COLS], train["navg"])
    test["p_event"] = clf.predict_proba(test[X_COLS])[:, 1]
    test["navg_hat"] = reg.predict(test[X_COLS])
    ok = test.dropna(subset=["spike_l1", "ev_m"])
    res = {
        "train_rows": int(len(train)), "test_rows": int(len(test)), "test_week": "2026-10-05~10-11",
        "event_rate_test": round(float(test["event"].mean()), 4),
        "auc_model": round(float(roc_auc_score(ok["event"], ok["p_event"])), 3),
        "auc_lastweek": round(float(roc_auc_score(ok["event"], ok["spike_l1"])), 3),
        "auc_hourmean": round(float(roc_auc_score(ok["event"], ok["ev_m"])), 3),
        "mae_navg_model": round(float(mean_absolute_error(ok["navg"], ok["navg_hat"])), 2),
        "mae_navg_lastweek": round(float(mean_absolute_error(ok["navg"], ok["navg_l1"])), 2),
        "mae_navg_hourmean": round(float(mean_absolute_error(ok["navg"], ok["navg_m"])), 2),
    }
    # 조용한 2시간 고르기: 모델 / 지난주 / 아무 데나(평균 비율)
    ok = ok.assign(rand=np.random.default_rng(0).random(len(ok)))
    res["calm_hit_model"] = round(calm_window_check(ok, "p_event"), 4)
    res["calm_hit_lastweek"] = round(calm_window_check(ok, "spike_l1"), 4)
    res["calm_hit_random"] = round(calm_window_check(ok, "rand"), 4)
    (out / "eval.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))
    # 시연용 다음 주 예측: 모든 주를 학습해 주 test_k+1 의 특징으로 예측(목표값 없이)
    full = pd.concat([features(d, k) for k in weeks[2:]], ignore_index=True)
    clf.fit(full[X_COLS], full["event"])
    reg.fit(full[X_COLS], full["navg"])
    nxt = d[d.week == test_k].assign(week=test_k + 1)       # 다음 주의 센서·시각 틀
    dd = pd.concat([d, nxt], ignore_index=True)
    fn = features(dd, test_k + 1)
    fn["p_event"] = clf.predict_proba(fn[X_COLS])[:, 1]
    fn["navg_hat"] = reg.predict(fn[X_COLS])
    fn[["serial", "zone", "dow", "hour", "p_event", "navg_hat", "ev_hm", "spike_m"]].to_parquet(out / "forecast.parquet", index=False)
    pickle.dump({"clf": clf, "reg": reg, "cols": X_COLS}, open(out / "model.pkl", "wb"))
    print("forecast rows", len(fn))


if __name__ == "__main__":
    main()
