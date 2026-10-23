"""무던한 지도 — 화면에 넣을 데이터(JSON)를 만든다.

센서마다: 주소·위경도·장소 유형·자치구, 요일×시각 168칸의 깜짝 소리 확률(모델 예측, ‰ 정수),
계속되는 소음(지난주 실측 평균 dB, 0.1 단위 정수), 근거로 보여 줄 지난 8주 같은 요일·시각 깜짝 소리 횟수.
실행: python projects/calm_map_2026/export.py  (prep.py, model.py 다음)
산출: projects/calm_map_2026/app/data.js
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

here = Path(__file__).resolve().parent
root = here.parents[1]
out = root / "workspace/contest_auto_clean/workspace/1023_2026_AI_라이프_솔루션_챌린지(0930~1031)/03_데이터/out"
app = here / "app"
app.mkdir(exist_ok=True)
GU = {"Jongno-gu": "종로구", "Jung-gu": "중구", "Yongsan-gu": "용산구", "Seongdong-gu": "성동구", "Gwangjin-gu": "광진구",
      "Dongdaemun-gu": "동대문구", "Jungnang-gu": "중랑구", "Seongbuk-gu": "성북구", "Gangbuk-gu": "강북구", "Dobong-gu": "도봉구",
      "Nowon-gu": "노원구", "Eunpyeong-gu": "은평구", "Seodaemun-gu": "서대문구", "Mapo-gu": "마포구", "Yangcheon-gu": "양천구",
      "Gangseo-gu": "강서구", "Guro-gu": "구로구", "Geumcheon-gu": "금천구", "Yeongdeungpo-gu": "영등포구", "Dongjak-gu": "동작구",
      "Gwanak-gu": "관악구", "Seocho-gu": "서초구", "Gangnam-gu": "강남구", "Songpa-gu": "송파구", "Gangdong-gu": "강동구",
      "Seoul_Grand_Park": "서울대공원"}


def main() -> None:
    s = pd.read_csv(out / "sensors.csv", encoding="utf-8-sig").dropna(subset=["lat"])
    fc = pd.read_parquet(out / "forecast.parquet")
    d = pd.read_parquet(out / "sdot_hourly.parquet")
    d["dow"], d["hour"] = d["time"].dt.weekday, d["time"].dt.hour
    last = d[d["time"] >= "2026-10-05"]
    navg = last.groupby(["serial", "dow", "hour"])["navg"].mean()
    ev = d.assign(e=(d["spike"] >= 10).astype(int)).groupby(["serial", "dow", "hour"])["e"].sum()
    weeks = d.assign(w=d["time"].dt.isocalendar().week).groupby(["serial", "dow", "hour"])["w"].nunique()
    fc = fc.set_index(["serial", "dow", "hour"])
    rows = []
    for r in s.itertuples():
        if r.serial not in fc.index.get_level_values(0):
            continue
        p, a, n, w = [], [], [], []
        for dow in range(7):
            for h in range(24):
                k = (r.serial, dow, h)
                p.append(int(round(float(fc["p_event"].get(k, float("nan"))) * 1000)) if k in fc.index else -1)
                a.append(int(round(navg.get(k, float("nan")) * 10)) if k in navg.index else -1)
                n.append(int(ev.get(k, 0)))
                w.append(int(weeks.get(k, 0)))
        # 설치 위치 원자료 87곳이 「서울측별시」로 잘못 적혀 있다(2026-10-24 확인) — 둘 다 떼어 낸다
        addr = re.sub(r"^서울[측특]별시(울)?\s*", "", str(r.addr))   # 「서울측별시울 용산구 …」 한 곳도 있다
        rows.append({"id": r.serial, "addr": addr, "lat": round(r.lat, 5), "lon": round(r.lon, 5), "zone": r.zone,
                     "gu": GU.get(r.gu, r.gu), "p": p, "a": a, "n": n, "w": w})
    ev_json = json.loads((out / "eval.json").read_text(encoding="utf-8"))
    payload = {"sensors": rows, "eval": ev_json, "trained": "2026-08-17~10-11", "spike_db": 10}
    (app / "data.js").write_text("window.CALM=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";",
                                 encoding="utf-8")
    print(len(rows), round((app / "data.js").stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
