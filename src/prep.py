"""무던한 지도 — S-DoT 환경정보 8주(2026-08-17~10-11)를 센서×시각 표로 정리한다.

갑작스러운 소리 = 그 시간의 소음 최대 − 평균(dB). 계속되는 소음 = 소음 평균(dB).
실행: python projects/calm_map_2026/prep.py
산출: 03_데이터/out/sdot_hourly.parquet, sensors.csv
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

root = Path(__file__).resolve().parents[2]
base = root / "workspace/contest_auto_clean/workspace/1023_2026_AI_라이프_솔루션_챌린지(0930~1031)/03_데이터"
raw, out = base / "raw", base / "out"
out.mkdir(exist_ok=True)
KEEP = {"시리얼": "serial", "측정시간": "time", "지역": "zone", "자치구": "gu", "행정동": "dong",
        "소음 최대(dB)": "nmax", "소음 평균(dB)": "navg", "소음 최소(dB)": "nmin",
        "조도 평균(lux)": "lux", "온도 평균(℃)": "temp"}
ZONE = {"residential_area": "주거지역", "roads_and_parks": "도로·공원", "traditional_markets": "전통시장",
        "industrial_area": "공업지역", "commercial_area": "상업지역", "main_street": "주요 거리",
        "parks": "공원", "public_facilities": "공공시설"}


def load() -> pd.DataFrame:
    parts = []
    for f in sorted(raw.glob("sdot_2026*.csv")):
        d = pd.read_csv(f, encoding="cp949", low_memory=False, index_col=False, usecols=list(KEEP))
        parts.append(d.rename(columns=KEEP))
    d = pd.concat(parts, ignore_index=True)
    d["time"] = pd.to_datetime(d["time"].str.slice(0, 13), format="%Y-%m-%d_%H")
    d = d.dropna(subset=["navg", "nmax"]).drop_duplicates(["serial", "time"])
    d["spike"] = d["nmax"] - d["navg"]
    d["zone"] = d["zone"].map(ZONE).fillna(d["zone"])
    return d


def sensors(d: pd.DataFrame) -> pd.DataFrame:
    loc = pd.read_excel(raw / "sdot_location.xlsx")
    loc = loc.rename(columns={"모델 시리얼(*)": "serial", "주소": "addr", "위도": "lat", "경도": "lon",
                              "변경 전 시리얼(데이터 상 표기)": "old"})
    m = pd.concat([loc[["serial", "addr", "lat", "lon"]],
                   loc.dropna(subset=["old"]).assign(serial=lambda x: x["old"])[["serial", "addr", "lat", "lon"]]])
    s = d.groupby("serial").agg(zone=("zone", "first"), gu=("gu", "first"), dong=("dong", "first"),
                                hours=("time", "size")).reset_index()
    return s.merge(m.drop_duplicates("serial"), on="serial", how="left")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    d = load()
    d.to_parquet(out / "sdot_hourly.parquet", index=False)
    s = sensors(d)
    s.to_csv(out / "sensors.csv", index=False, encoding="utf-8-sig")
    print(d.shape, d["time"].min(), d["time"].max(), "sensors", len(s), "with coords", s["lat"].notna().sum())
    print(d[["navg", "nmax", "spike"]].describe().round(2).T)
    print((d["spike"] >= 10).mean().round(3), "share of sensor-hours with spike>=10dB")


if __name__ == "__main__":
    main()
