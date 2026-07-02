/** Parses year selections like "2024", "2020-2023", "2019,2021-2022". */

const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

function parseYearToken(token: string): number {
  if (!/^\d{4}$/.test(token)) {
    throw new Error(`Invalid year '${token}'. Expected a 4-digit year.`);
  }
  const year = Number.parseInt(token, 10);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new Error(`Year '${token}' is out of supported range (${MIN_YEAR}-${MAX_YEAR}).`);
  }
  return year;
}

export function parseYearsInput(input: string): number[] {
  if (input.trim().length === 0) {
    throw new Error("Years must be a non-empty string.");
  }

  const years = new Set<number>();
  const parts = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("No valid years were provided.");
  }

  for (const part of parts) {
    if (part.includes("-")) {
      const pieces = part.split("-").map((x) => x.trim());
      if (pieces.length !== 2 || !pieces[0] || !pieces[1]) {
        throw new Error(`Invalid year range '${part}'. Use 'YYYY-YYYY'.`);
      }
      const start = parseYearToken(pieces[0]);
      const end = parseYearToken(pieces[1]);
      if (start > end) {
        throw new Error(`Invalid year range '${part}'. Start year must be <= end year.`);
      }
      for (let year = start; year <= end; year += 1) {
        years.add(year);
      }
    } else {
      years.add(parseYearToken(part));
    }
  }

  return Array.from(years).sort((a, b) => a - b);
}
