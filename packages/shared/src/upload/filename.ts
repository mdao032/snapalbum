export interface MediaFileNameInput {
  takenAt: Date;
  guestName: string | null;
  /** 1-based position of the file in the album export. */
  index: number;
  extension: string;
  /** IANA time zone used to read the date, UTC by default. */
  timeZone?: string;
}

/** "Élodie D." -> "elodie-d"; empty -> "invite". */
export function slugifyGuestName(name: string | null): string {
  const slug = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return slug || "invite";
}

/** `AAAA-MM-JJ_HHMMSS_prenom-invite_n.ext` (F-083). */
export function formatMediaFileName(input: MediaFileNameInput): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: input.timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input.takenAt);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}${get("minute")}${get("second")}`;
  const extension = input.extension.replace(/^\./, "").toLowerCase();
  return `${date}_${time}_${slugifyGuestName(input.guestName)}_${input.index}.${extension}`;
}
