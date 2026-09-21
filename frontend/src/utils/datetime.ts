const TZ = "Asia/Taipei";

const timeFmt = new Intl.DateTimeFormat("zh-TW", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toTaipeiTime(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  return timeFmt.format(d);
}

export function toTaipeiDate(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  return dateFmt.format(d);
}
