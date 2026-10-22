import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import type { GeoPoint } from "./explore-data";
import type { LedgerRow } from "./ledger-data";
import { ledgerDay } from "./ledger-data";
import "leaflet/dist/leaflet.css";

type Point = GeoPoint & { row: LedgerRow };
function FitPoints({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 15 });
    const frame = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(frame);
  }, [map, points]);
  return null;
}
export default function LedgerLocationMap({ points }: { points: Point[] }) {
  const [failed, setFailed] = useState(false);
  if (!points.length) return null;
  return <div className="lx-map-wrapper">
    {failed ? <p role="status" className="lx-warning">地圖底圖暫時無法載入；下方的已記錄地點清單仍可查看。</p> : null}
    <MapContainer center={[points[0].lat, points[0].lng]} zoom={13} maxZoom={17} minZoom={2} scrollWheelZoom={false} className="lx-map" aria-label="消費地點地圖">
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={17}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
        eventHandlers={{ tileerror: () => setFailed(true) }} />
      <FitPoints points={points} />
      {points.slice(0, 300).map((point) => <CircleMarker key={point.row.id} center={[point.lat, point.lng]} radius={7} pathOptions={{ color: "#a8551f", fillColor: "#d0713f", fillOpacity: 0.8 }}>
        <Popup><strong>{point.row.merchant || "消費"}</strong><p>{ledgerDay(point.row)} · {point.row.currency} {Math.abs(point.row.amount_minor! / 100).toLocaleString("zh-TW")}</p>{point.label ? <p>{point.label}</p> : null}</Popup>
      </CircleMarker>)}
    </MapContainer>
    {points.length > 300 ? <p className="lx-hint">地圖先顯示最近 300 筆定位，請縮小月份範圍；清單與統計仍涵蓋目前篩選結果。</p> : null}
    <a className="lx-map-issue" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">回報底圖問題</a>
  </div>;
}
