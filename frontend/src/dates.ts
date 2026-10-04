export const TZ = 'Asia/Yekaterinburg'; // ТюмГУ

const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const toYmd = (d: Date | string) => ymdFmt.format(typeof d === 'string' ? new Date(d) : d);
export const todayYmd = () => toYmd(new Date());

const utc = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const addDays = (ymd: string, n: number) => new Date(utc(ymd).getTime() + n * 86400000).toISOString().slice(0, 10);
export const mondayOf = (ymd: string) => addDays(ymd, -((utc(ymd).getUTCDay() + 6) % 7));

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtDayShort = (ymd: string) => utc(ymd).toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'short' }).replace('.', '');
export const fmtDayNum = (ymd: string) => String(Number(ymd.slice(8, 10)));
export const fmtDayLong = (ymd: string) => utc(ymd).toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
export const fmtWeek = (from: string) => {
  const a = utc(from), b = utc(addDays(from, 6));
  const o: Intl.DateTimeFormatOptions = { timeZone: 'UTC', day: 'numeric', month: 'short' };
  return `${a.toLocaleDateString('ru-RU', o)} — ${b.toLocaleDateString('ru-RU', o)}`;
};
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
