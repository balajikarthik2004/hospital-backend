import { describe, expect, it } from 'vitest';

import { outstandingBlockingFlags, screenPrescription } from './prescriptionSafety.js';

/**
 * These are the checks that stand between a prescription and a patient, so
 * they are tested by consequence rather than by shape: for each case, would
 * the pharmacy be stopped, and would the pharmacist be told enough to act?
 */

const item = (drugName: string, dosage = '10 mg', frequency = 'once daily') => ({
  drugName,
  dosage,
  frequency,
});

describe('allergy screening', () => {
  it('blocks a drug the patient is documented as allergic to', () => {
    const result = screenPrescription({
      items: [item('Amoxicillin', '500 mg', 'three times a day')],
      allergies: [{ substance: 'Penicillin', severity: 'severe' }],
    });

    const flag = result.flags.find((f) => f.type === 'allergy_conflict');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('critical');
    expect(flag?.recommendation).toMatch(/do not dispense/i);
    expect(result.passed).toBe(false);
  });

  it('catches an allergy to the exact drug, not only to a class', () => {
    const result = screenPrescription({
      items: [item('Warfarin', '5 mg')],
      allergies: [{ substance: 'Warfarin' }],
    });
    expect(result.flags.some((f) => f.type === 'allergy_conflict')).toBe(true);
  });

  it('passes a drug the patient has no allergy to', () => {
    const result = screenPrescription({
      items: [item('Paracetamol', '500 mg', 'four times a day')],
      allergies: [{ substance: 'Penicillin' }],
    });
    expect(result.flags.some((f) => f.type === 'allergy_conflict')).toBe(false);
  });
});

describe('interaction screening', () => {
  it('catches an interaction between two drugs on the same prescription', () => {
    const result = screenPrescription({
      items: [item('Warfarin', '5 mg'), item('Aspirin', '81 mg')],
    });

    const flag = result.flags.find((f) => f.type === 'interaction');
    expect(flag).toBeDefined();
    expect([flag?.drugA, flag?.drugB]).toContain('Warfarin');
    expect([flag?.drugA, flag?.drugB]).toContain('Aspirin');
    expect(flag?.description.length).toBeGreaterThan(0);
  });

  it('catches an interaction with what the patient already takes', () => {
    // The dangerous pair is usually one new drug and one long-standing one.
    const result = screenPrescription({
      items: [item('Aspirin', '81 mg')],
      currentMedications: [{ drugName: 'Warfarin' }],
    });

    const flag = result.flags.find((f) => f.type === 'interaction');
    expect(flag).toBeDefined();
    expect(flag?.description).toMatch(/already taking/i);
    expect(result.passed).toBe(false);
  });

  it('does not report the same cross-interaction twice', () => {
    const result = screenPrescription({
      items: [item('Aspirin', '81 mg')],
      currentMedications: [{ drugName: 'Warfarin' }, { drugName: 'warfarin' }],
    });
    expect(result.flags.filter((f) => f.type === 'interaction')).toHaveLength(1);
  });

  it('leaves an unrelated pair alone', () => {
    const result = screenPrescription({
      items: [item('Paracetamol', '500 mg'), item('Vitamin D', '1000 iu')],
    });
    expect(result.flags.some((f) => f.type === 'interaction')).toBe(false);
  });
});

describe('duplication', () => {
  it('flags the same drug listed twice on one prescription', () => {
    const result = screenPrescription({
      items: [item('Metformin', '500 mg'), item('Metformin', '1000 mg')],
    });
    const flag = result.flags.find((f) => f.type === 'duplication');
    expect(flag).toBeDefined();
    expect(flag?.description).toMatch(/appears 2 times/i);
  });

  it('flags prescribing something the patient is already on', () => {
    const result = screenPrescription({
      items: [item('Metformin', '500 mg')],
      currentMedications: [{ drugName: 'Metformin' }],
    });
    const flag = result.flags.find((f) => f.type === 'duplication');
    expect(flag?.severity).toBe('high');
    expect(flag?.description).toMatch(/double their dose/i);
    expect(result.passed).toBe(false);
  });
});

describe('incomplete instructions', () => {
  it('blocks an item with no dose', () => {
    const result = screenPrescription({
      items: [{ drugName: 'Amoxicillin', dosage: '', frequency: 'twice daily' }],
    });
    const flag = result.flags.find((f) => f.type === 'unclear_instruction');
    expect(flag?.severity).toBe('high');
    expect(flag?.description).toMatch(/no dose/i);
    expect(result.passed).toBe(false);
  });

  it('blocks an item with no frequency', () => {
    const result = screenPrescription({
      items: [{ drugName: 'Amoxicillin', dosage: '500 mg', frequency: '' }],
    });
    expect(
      result.flags.find((f) => f.type === 'unclear_instruction')?.description
    ).toMatch(/no frequency/i);
  });

  it('names both when both are missing', () => {
    const result = screenPrescription({
      items: [{ drugName: 'Amoxicillin', dosage: '', frequency: '' }],
    });
    expect(
      result.flags.find((f) => f.type === 'unclear_instruction')?.description
    ).toMatch(/no dose and frequency/i);
  });
});

describe('high-risk agents', () => {
  it('asks for counselling on a high-risk drug', () => {
    const result = screenPrescription({ items: [item('Warfarin', '5 mg')] });
    const flag = result.flags.find((f) => f.type === 'high_risk');
    expect(flag).toBeDefined();
    expect(flag?.recommendation).toMatch(/counsel/i);
  });

  it('stays quiet when something more specific already named the drug', () => {
    // A pharmacist reading "warfarin is high risk" underneath a critical
    // interaction about warfarin learns nothing and starts skimming.
    const result = screenPrescription({
      items: [item('Warfarin', '5 mg'), item('Aspirin', '81 mg')],
    });
    expect(result.flags.some((f) => f.type === 'high_risk' && f.drugA === 'Warfarin')).toBe(
      false
    );
  });

  it('does not block dispensing on its own', () => {
    const result = screenPrescription({ items: [item('Warfarin', '5 mg')] });
    expect(result.passed).toBe(true);
  });
});

describe('overall verdict', () => {
  it('passes a clean prescription', () => {
    const result = screenPrescription({
      items: [item('Paracetamol', '500 mg', 'four times a day')],
      allergies: [],
      currentMedications: [],
    });
    expect(result.flags).toHaveLength(0);
    expect(result.passed).toBe(true);
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  it('sorts the most severe flag first', () => {
    const result = screenPrescription({
      items: [
        item('Amoxicillin', '500 mg', 'three times a day'),
        item('Warfarin', '5 mg'),
      ],
      allergies: [{ substance: 'Penicillin' }],
    });
    expect(result.flags[0].severity).toBe('critical');
  });

  it('ignores blank rows rather than flagging them as incomplete', () => {
    const result = screenPrescription({
      items: [item('Paracetamol', '500 mg'), { drugName: '   ' }],
    });
    expect(result.flags).toHaveLength(0);
  });
});

describe('outstandingBlockingFlags', () => {
  it('counts unacknowledged critical and high flags', () => {
    expect(
      outstandingBlockingFlags([
        { severity: 'critical', acknowledged: false },
        { severity: 'high', acknowledged: false },
        { severity: 'medium', acknowledged: false },
        { severity: 'low' },
      ])
    ).toBe(2);
  });

  it('stops counting a flag once a pharmacist has signed it off', () => {
    expect(
      outstandingBlockingFlags([
        { severity: 'critical', acknowledged: true },
        { severity: 'high', acknowledged: true },
      ])
    ).toBe(0);
  });

  it('never blocks on medium or low alone', () => {
    expect(
      outstandingBlockingFlags([
        { severity: 'medium', acknowledged: false },
        { severity: 'low', acknowledged: false },
      ])
    ).toBe(0);
  });
});
