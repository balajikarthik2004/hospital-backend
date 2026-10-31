import type { Model } from 'mongoose';

function stamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Generates sequential human-readable identifiers in the spec's
 * `PREFIX-YYYYMMDD-XXXX` format, scoped to the current day.
 */
export async function nextId(
  model: Model<any>,
  field: string,
  prefix: string,
  date = new Date()
): Promise<string> {
  const day = stamp(date);
  const re = new RegExp(`^${prefix}-${day}-(\\d{4})$`);
  const latest = await model
    .findOne({ [field]: re })
    .sort({ [field]: -1 })
    .select(field)
    .lean<Record<string, string>>();

  const seq = latest ? Number(String(latest[field]).slice(-4)) + 1 : 1;
  return `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
}

export const ID_PREFIX = {
  patient: 'PAT',
  admission: 'ADM',
  appointment: 'APT',
  discharge: 'DIS',
} as const;
