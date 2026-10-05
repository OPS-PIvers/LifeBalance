import { describe, expect, it } from 'vitest';
import type { HouseholdMember } from '@/types/schema';
import { makeWallPeople } from './wallPeople';

const members = [
  { uid: 'p', displayName: 'Paul' },
  { uid: 'j', displayName: 'Jess' },
] as HouseholdMember[];

describe('makeWallPeople', () => {
  it('names and colors members, with Family for no owner', () => {
    const light = makeWallPeople(members, false);
    expect(light.name('p')).toBe('Paul');
    expect(light.name('family')).toBe('Family');
    expect(light.name(undefined)).toBe('Family');
    expect(light.name('gone')).toBe('Someone');
    expect(light.initial('j')).toBe('J');
    expect(light.color('p')).toBe('#285742');
    expect(light.color('family')).toBe('#6e685d');
    expect(light.members.map(m => m.name)).toEqual(['Paul', 'Jess']);
  });

  it('switches to the dark palette', () => {
    const dark = makeWallPeople(members, true);
    expect(dark.color('p')).toBe('#86b89c');
    expect(dark.color('j')).toBe('#d6a55e');
    expect(dark.color(undefined)).toBe('#a8a399');
  });
});

describe('firstName', () => {
  it('is the first word of a member’s name, or null for Family and strangers', () => {
    const people = makeWallPeople([{ uid: 'u1', displayName: 'Leo Ivers', role: 'member' } as HouseholdMember], false);
    expect(people.firstName('u1')).toBe('Leo');
    expect(people.firstName('family')).toBeNull();
    expect(people.firstName('gone')).toBeNull();
  });
});
