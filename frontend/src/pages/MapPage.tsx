import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { MapPin, RefreshCcw } from "lucide-react";
import { api } from "../api";
import type { Transaction } from "../types";
import { useStore } from "../store/useStore";
import "leaflet/dist/leaflet.css";

type GeoTxn = {
  tx: Transaction;
  lat: number;
  lng: number;
  locationName: string | null;
  seq: number;
};

function buildPinIcon(seq: number, amountLabel: string, accent: boolean) {
  const size: [number, number] = accent ? [96, 32] : [84, 28];
  return L.divIcon({
    className: "map-pin-icon",
    html: `<div class="map-pin-v2${accent ? " accent" : ""}"><span class="pin-seq">${seq}</span><span class="pin-amt">${amountLabel}</span></div>`,
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1]],
  });
}

function parseGeo(notes: string | null | undefined): { lat: number; lng: number; name: string | null } | null {
  if (!notes) return null;
  const m = notes.match(/🗺️\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const loc = notes.match(/📍([^·]+?)(?:\s*·|$)/);
  return { lat, lng, name: loc ? loc[1].trim() : null };
}

function isAccentTier(amountCents: number): boolean {
  return Math.abs(amountCents) > 200000;
}

type RangeKey = "week" | "month" | "all";
const RANGE_META: Record<RangeKey, { label: string; days: number }> = {
  week: { label: "本週", days: 7 },
  month: { label: "本月", days: 30 },
  all: { label: "全部", days: 36500 },
};

export function MapPage() {
  const pushToast = useStore((s) => s.pushToast);
  const [txns, setTxns] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("month");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  const load = () => {
    setLoading(true);
    api
      .listTransactions({ limit: 5000 })
      .then(setTxns)
      .catch(() => pushToast("error", "載入交易失敗"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const geoTxns = useMemo<GeoTxn[]>(() => {
    if (!txns) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_META[range].days);
    const matched = txns
      .filter((t) => {
        if (t.amount >= 0) return false;
        const d = new Date(`${t.date}T12:00:00`);
        return d >= cutoff;
      })
      .map((t) => {
        const g = parseGeo(t.notes);
        return g ? { tx: t, lat: g.lat, lng: g.lng, locationName: g.name } : null;
      })
      .filter((x): x is Omit<GeoTxn, "seq"> => x !== null)
      .sort((a, b) => a.tx.occurred_at.localeCompare(b.tx.occurred_at));
    return matched.map((g, i) => ({ ...g, seq: i + 1 }));
  }, [txns, range]);

  // 有紀錄的每一天，依日期排序，供下方日期 chip 使用
  const dayList = useMemo<string[]>(() => {
    const days = new Set(geoTxns.map((g) => g.tx.date));
    return Array.from(days).sort();
  }, [geoTxns]);

  // 換範圍或資料重載後，若選中的那天已不在清單裡就重置
  useEffect(() => {
    if (selectedDay && !dayList.includes(selectedDay)) {
      setSelectedDay(null);
    }
  }, [dayList, selectedDay]);

  const visibleGeoTxns = useMemo<GeoTxn[]>(() => {
    if (!selectedDay) return geoTxns;
    return geoTxns.filter((g) => g.tx.date === selectedDay);
  }, [geoTxns, selectedDay]);

  const visibleSpendMinor = useMemo(
    () => visibleGeoTxns.reduce((sum, g) => sum + Math.abs(g.tx.amount), 0),
    [visibleGeoTxns],
  );
  const visibleLocationCount = useMemo(
    () => new Set(visibleGeoTxns.map((g) => `${g.lat.toFixed(5)},${g.lng.toFixed(5)}`)).size,
    [visibleGeoTxns],
  );
  const activeDateLabel = selectedDay
    ? selectedDay.slice(5).replace("-", "/")
    : RANGE_META[range].label;

  // 只在選定單一天時畫消費軌跡，範圍是「本週/本月/全部」時不畫
  const routePoints = useMemo<[number, number][]>(() => {
    if (!selectedDay || visibleGeoTxns.length < 2) return [];
    return visibleGeoTxns.map((g) => [g.lat, g.lng]);
  }, [selectedDay, visibleGeoTxns]);

  const bounds = useMemo(() => {
    if (visibleGeoTxns.length === 0) return null;
    return L.latLngBounds(visibleGeoTxns.map((g) => [g.lat, g.lng] as [number, number]));
  }, [visibleGeoTxns]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    map.fitBounds(bounds, { padding: [28, 28] });
    let timer: ReturnType<typeof setTimeout>;
    const raf = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [28, 28] });
      }, 80);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [bounds]);

  const center = useMemo<[number, number]>(() => {
    if (geoTxns.length === 0) return [25.033, 121.565];
    const lat = geoTxns.reduce((s, g) => s + g.lat, 0) / geoTxns.length;
    const lng = geoTxns.reduce((s, g) => s + g.lng, 0) / geoTxns.length;
    return [lat, lng];
  }, [geoTxns]);

  return (
    <div className="map-page">
      <header className="page-header">
        <p className="section-eyebrow">消費地圖</p>
        <h1 className="page-title">花在哪裡，一看就懂</h1>
        <p className="section-description">
          Apple Pay 記帳附帶的定位會攤在這張地圖上（捷徑要開啟「取得目前位置」）。
        </p>
      </header>

      <div className="map-toolbar">
        <div className="map-range-row" role="tablist" aria-label="日期範圍">
          {(Object.keys(RANGE_META) as RangeKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-pressed={range === k}
              className="chip-btn"
              onClick={() => {
                setRange(k);
                setSelectedDay(null);
              }}
            >
              {RANGE_META[k].label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button map-refresh" aria-label="重新載入" onClick={load}>
          <RefreshCcw size={16} aria-hidden="true" />
        </button>
      </div>

      {loading ? (
        <div className="map-loading">載入中…</div>
      ) : geoTxns.length === 0 ? (
        <div className="map-empty">
          <MapPin size={32} aria-hidden="true" />
          <p>這個範圍內沒有帶定位的消費</p>
          <p className="map-empty-hint">
            iOS 捷徑加入「取得目前位置」並把緯度／經度放進 latitude/longitude 欄位就會出現在這裡。
          </p>
        </div>
      ) : (
        <>
          <div className="map-card">
            <div className="map-overlay map-overlay--left">
              <span className="map-overlay-kicker">{activeDateLabel}</span>
              <strong>{visibleGeoTxns.length} 筆消費</strong>
            </div>
            <div className="map-overlay map-overlay--right">
              <span className="map-overlay-kicker">合計</span>
              <strong>NT${Math.round(visibleSpendMinor / 100).toLocaleString("zh-TW")}</strong>
            </div>
            <MapContainer
              ref={mapRef}
              center={center}
              zoom={14}
              scrollWheelZoom={false}
              className="map-canvas"
              aria-label="消費地圖"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {routePoints.length > 1 && (
                <Polyline
                  positions={routePoints}
                  // #2f54c4 = --accent token值；Leaflet SVG path 屬性不吃 var()，直接寫死同值
                  pathOptions={{ color: "#2f54c4", weight: 3.5, opacity: 0.85, lineCap: "round", lineJoin: "round" }}
                />
              )}
              {visibleGeoTxns.map((g) => {
                const accent = isAccentTier(g.tx.amount);
                const amountLabel = `NT$${Math.round(Math.abs(g.tx.amount) / 100).toLocaleString("zh-TW")}`;
                return (
                  <Marker
                    key={g.tx.id}
                    position={[g.lat, g.lng]}
                    icon={buildPinIcon(g.seq, amountLabel, accent)}
                  >
                    <Popup className="map-popup">
                      <div className="map-popup-inner">
                        <span className="map-popup-date">
                          #{g.seq} · {g.tx.date}
                        </span>
                        <strong className="map-popup-merchant">{g.tx.merchant || "消費"}</strong>
                        <span className="map-popup-amount">{amountLabel}</span>
                        {g.locationName && (
                          <span className="map-popup-location">{g.locationName}</span>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>

            {dayList.length > 0 && (
              <div className="map-day-row" role="tablist" aria-label="選擇日期">
                <button
                  type="button"
                  role="tab"
                  aria-pressed={selectedDay === null}
                  className="map-day-chip"
                  onClick={() => setSelectedDay(null)}
                >
                  全部
                </button>
                {dayList.map((day) => (
                  <button
                    key={day}
                    type="button"
                    role="tab"
                    aria-pressed={selectedDay === day}
                    className="map-day-chip"
                    onClick={() => setSelectedDay(day)}
                  >
                    {day.slice(5).replace("-", "/")}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="map-summary-strip" aria-label="地圖摘要">
            <div>
              <span>定位點</span>
              <strong>{visibleLocationCount}</strong>
            </div>
            <div>
              <span>有定位消費</span>
              <strong>{visibleGeoTxns.length}</strong>
            </div>
            <div>
              <span>區間</span>
              <strong>{activeDateLabel}</strong>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
