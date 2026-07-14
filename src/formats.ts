/**
 * Checkers for well-known `format` values. JSON Schema treats format as an
 * annotation, so a failed format is a warning (W203) by default and only
 * fails the run under --strict; formats examplint has no checker for are
 * surfaced once per site as W204 instead of being silently ignored.
 */

export type FormatChecker = (value: string | number) => boolean;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|z|[+-]\d{2}:\d{2})$/;
const DURATION_RE = /^P(?=.)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=.)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IPV4_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isValidDate(text: string): boolean {
  const match = DATE_RE.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1]!;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidTime(text: string): boolean {
  const match = TIME_RE.exec(text);
  if (match === null) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  return hour <= 23 && minute <= 59 && second <= 60; // 60 = leap second
}

function isValidDateTime(text: string): boolean {
  const t = text.indexOf("T");
  const tLower = text.indexOf("t");
  const split = t !== -1 ? t : tLower;
  if (split === -1) return false;
  return isValidDate(text.slice(0, split)) && isValidTime(text.slice(split + 1));
}

function isValidIpv6(text: string): boolean {
  if (text.includes(":::") || text.length < 2) return false;
  const doubleColons = text.split("::").length - 1;
  if (doubleColons > 1) return false;
  const [head = "", tail = ""] = text.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === "" ? [] : tail.split(":");
  const groups = [...headGroups, ...tailGroups];
  if (doubleColons === 0 && groups.length !== 8) return false;
  if (doubleColons === 1 && groups.length >= 8) return false;
  return groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
}

function isValidUri(text: string, requireScheme: boolean): boolean {
  if (/\s/.test(text) || text === "") return false;
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text);
  return requireScheme ? hasScheme : true;
}

/** Checkers keyed by format name. String checkers receive strings only. */
export const FORMAT_CHECKERS: Record<string, FormatChecker> = {
  date: (v) => typeof v === "string" && isValidDate(v),
  time: (v) => typeof v === "string" && isValidTime(v),
  "date-time": (v) => typeof v === "string" && isValidDateTime(v),
  duration: (v) => typeof v === "string" && DURATION_RE.test(v),
  email: (v) => typeof v === "string" && EMAIL_RE.test(v),
  uuid: (v) => typeof v === "string" && UUID_RE.test(v),
  uri: (v) => typeof v === "string" && isValidUri(v, true),
  "uri-reference": (v) => typeof v === "string" && isValidUri(v, false),
  hostname: (v) => typeof v === "string" && HOSTNAME_RE.test(v),
  ipv4: (v) => typeof v === "string" && IPV4_RE.test(v),
  ipv6: (v) => typeof v === "string" && isValidIpv6(v),
  byte: (v) => typeof v === "string" && BASE64_RE.test(v),
  int32: (v) => typeof v === "number" && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647,
  int64: (v) => typeof v === "number" && Number.isInteger(v) && Number.isSafeInteger(v),
  float: (v) => typeof v === "number" && Number.isFinite(v),
  double: (v) => typeof v === "number" && Number.isFinite(v),
};

/** Formats that are declared valid-by-definition (nothing to check offline). */
export const OPAQUE_FORMATS = new Set(["binary", "password"]);

/** A canonical valid value per format, used in fix suggestions. */
export const FORMAT_SAMPLES: Record<string, string> = {
  date: "2026-07-12",
  time: "09:30:00Z",
  "date-time": "2026-07-12T09:30:00Z",
  duration: "P3DT4H",
  email: "dev@example.test",
  uuid: "3f2b6c1e-8a4d-4f60-9b2a-5c7d8e9f0a1b",
  uri: "https://example.test/path",
  "uri-reference": "/path",
  hostname: "api.example.test",
  ipv4: "127.0.0.1",
  ipv6: "::1",
  byte: "aGVsbG8=",
  int32: "2147483647",
  int64: "9007199254740991",
  float: "1.5",
  double: "1.5",
};
